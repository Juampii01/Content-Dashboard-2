"""Convierte el modelo de recorte de persona de MediaPipe (selfie_segmentation.tflite, Apache-2.0) a ONNX.

El modelo usa una operación propia de MediaPipe (Convolution2DTransposeBias) que ni onnxruntime ni los conversores
comunes conocen. Este conversor lee el flatbuffer del .tflite (paquete `tflite`) y arma el grafo ONNX a mano con las
11 operaciones que tiene el modelo (convoluciones, activaciones, pooling, resize y la transpuesta con sesgo), pasando
de NHWC a NCHW. Los pesos en float16 se pasan a float32 al convertir.

    python scripts/tflite_selfie_to_onnx.py selfie_segmentation.tflite selfie_segmentation.onnx

Se corre una vez al construir la imagen (scripts/fetch_models.py); el resultado se compara contra salidas fijas en
las pruebas (tests/test_fx_mask.py).
"""

from __future__ import annotations

import struct
import sys
from pathlib import Path

import numpy as np


def convert(src: Path, dst: Path) -> None:
    import onnx
    import tflite
    from onnx import TensorProto, helper, numpy_helper

    buf = src.read_bytes()
    model = tflite.Model.GetRootAsModel(buf, 0)
    graph = model.Subgraphs(0)
    names = {v: k for k, v in tflite.BuiltinOperator.__dict__.items() if not k.startswith("_")}

    def opname(op) -> str:
        code = model.OperatorCodes(op.OpcodeIndex())
        b = max(code.BuiltinCode(), code.DeprecatedBuiltinCode())
        return "CUSTOM:" + code.CustomCode().decode() if b == tflite.BuiltinOperator.CUSTOM else names[b]

    np_type = {tflite.TensorType.FLOAT32: np.float32, tflite.TensorType.FLOAT16: np.float16, tflite.TensorType.INT32: np.int32}

    def const(i: int) -> np.ndarray | None:
        t = graph.Tensors(i)
        b = model.Buffers(t.Buffer())
        if b.DataLength() == 0:
            return None
        return np.frombuffer(b.DataAsNumpy().tobytes(), dtype=np_type[t.Type()]).reshape(t.ShapeAsNumpy() if t.ShapeLength() else ())

    shape = lambda i: [int(x) for x in graph.Tensors(i).ShapeAsNumpy()]  # noqa: E731
    consts: dict[int, np.ndarray] = {}
    nodes, inits = [], []
    tname = lambda i: f"t{i}"  # noqa: E731

    def init(name: str, arr: np.ndarray) -> str:
        inits.append(numpy_helper.from_array(np.ascontiguousarray(arr), name))
        return name

    def act(out: str, fused: int) -> list:
        if fused == tflite.ActivationFunctionType.RELU:
            return [helper.make_node("Relu", [out + "_pre"], [out])]
        if fused == tflite.ActivationFunctionType.RELU6:
            return [helper.make_node("Clip", [out + "_pre", init(out + "_lo", np.array(0, np.float32)), init(out + "_hi", np.array(6, np.float32))], [out])]
        return [helper.make_node("Identity", [out + "_pre"], [out])]

    def same_pads(in_hw, k, s):
        pads = []
        for n, kk, ss in zip(in_hw, k, s):
            out = -(-n // ss)
            total = max((out - 1) * ss + kk - n, 0)
            pads.append((total // 2, total - total // 2))
        return [pads[0][0], pads[1][0], pads[0][1], pads[1][1]]

    def operand(i: int) -> str:
        if i in consts:
            arr = consts[i].astype(np.float32)
            if arr.ndim == 4:  # NHWC → NCHW
                arr = arr.transpose(0, 3, 1, 2)
            elif arr.ndim == 1:
                arr = arr.reshape(1, -1, 1, 1)
            return init(f"c{i}", arr)
        return tname(i)

    for i in range(graph.TensorsLength()):
        c = const(i)
        if c is not None:
            consts[i] = c

    inp = graph.Inputs(0)
    nodes.append(helper.make_node("Transpose", ["input"], [tname(inp)], perm=[0, 3, 1, 2]))
    for k in range(graph.OperatorsLength()):
        op = graph.Operators(k)
        kind = opname(op)
        ins = [op.Inputs(j) for j in range(op.InputsLength())]
        out = op.Outputs(0)
        o = tname(out)
        if kind == "DEQUANTIZE":
            consts[out] = consts[ins[0]].astype(np.float32)
            continue
        if kind in ("CONV_2D", "DEPTHWISE_CONV_2D"):
            opt = (tflite.Conv2DOptions if kind == "CONV_2D" else tflite.DepthwiseConv2DOptions)()
            opt.Init(op.BuiltinOptions().Bytes, op.BuiltinOptions().Pos)
            w = consts[ins[1]]  # [O,H,W,I] o [1,H,W,C*M]
            bias = consts[ins[2]] if len(ins) > 2 and ins[2] >= 0 else np.zeros(w.shape[-1 if kind != "CONV_2D" else 0], np.float32)
            kh, kw = w.shape[1], w.shape[2]
            s = (opt.StrideH(), opt.StrideW())
            in_shape = shape(ins[0])
            if kind == "CONV_2D":
                wt, group = w.transpose(0, 3, 1, 2), 1
            else:
                wt, group = w.transpose(3, 0, 1, 2), in_shape[3]
            pads = same_pads(in_shape[1:3], (kh, kw), s) if opt.Padding() == tflite.Padding.SAME else [0, 0, 0, 0]
            nodes.append(helper.make_node("Conv", [tname(ins[0]), init(f"w{k}", wt.astype(np.float32)), init(f"b{k}", bias.astype(np.float32))], [o + "_pre"], kernel_shape=[kh, kw], strides=list(s), pads=pads, group=group))
            nodes += act(o, opt.FusedActivationFunction())
        elif kind in ("ADD", "MUL"):
            opt = (tflite.AddOptions if kind == "ADD" else tflite.MulOptions)()
            opt.Init(op.BuiltinOptions().Bytes, op.BuiltinOptions().Pos)
            nodes.append(helper.make_node("Add" if kind == "ADD" else "Mul", [operand(ins[0]), operand(ins[1])], [o + "_pre"]))
            nodes += act(o, opt.FusedActivationFunction())
        elif kind == "RELU":
            nodes.append(helper.make_node("Relu", [tname(ins[0])], [o]))
        elif kind == "HARD_SWISH":
            nodes.append(helper.make_node("HardSwish", [tname(ins[0])], [o]))
        elif kind == "LOGISTIC":
            nodes.append(helper.make_node("Sigmoid", [tname(ins[0])], [o]))
        elif kind == "AVERAGE_POOL_2D":
            opt = tflite.Pool2DOptions()
            opt.Init(op.BuiltinOptions().Bytes, op.BuiltinOptions().Pos)
            kh, kw = opt.FilterHeight(), opt.FilterWidth()
            in_shape = shape(ins[0])
            s = (opt.StrideH(), opt.StrideW())
            pads = same_pads(in_shape[1:3], (kh, kw), s) if opt.Padding() == tflite.Padding.SAME else [0, 0, 0, 0]
            nodes.append(helper.make_node("AveragePool", [tname(ins[0])], [o + "_pre"], kernel_shape=[kh, kw], strides=list(s), pads=pads, count_include_pad=0))
            nodes += act(o, opt.FusedActivationFunction())
        elif kind == "RESIZE_BILINEAR":
            opt = tflite.ResizeBilinearOptions()
            opt.Init(op.BuiltinOptions().Bytes, op.BuiltinOptions().Pos)
            size = consts[ins[1]].astype(np.int64)
            c = shape(ins[0])[3]
            mode = "align_corners" if opt.AlignCorners() else "half_pixel" if opt.HalfPixelCenters() else "asymmetric"
            nodes.append(helper.make_node("Resize", [tname(ins[0]), "", "", init(f"sz{k}", np.array([1, c, size[0], size[1]], np.int64))], [o], mode="linear", coordinate_transformation_mode=mode))
        elif kind == "CUSTOM:Convolution2DTransposeBias":
            raw = op.CustomOptionsAsNumpy().tobytes()
            padding, stride_w, stride_h = struct.unpack("<iii", raw[:12])
            w = consts[ins[1]]  # [O,H,W,I]
            bias = consts[ins[2]].astype(np.float32)
            kh, kw = w.shape[1], w.shape[2]
            in_shape = shape(ins[0])
            out_shape = shape(out)
            th = max((in_shape[1] - 1) * stride_h + kh - out_shape[1], 0)
            tw = max((in_shape[2] - 1) * stride_w + kw - out_shape[2], 0)
            pads = [th // 2, tw // 2, th - th // 2, tw - tw // 2] if padding == 1 else [0, 0, th, tw]
            nodes.append(
                helper.make_node(
                    "ConvTranspose",
                    [tname(ins[0]), init(f"w{k}", w.transpose(3, 0, 1, 2).astype(np.float32)), init(f"b{k}", bias)],
                    [o],
                    kernel_shape=[kh, kw],
                    strides=[stride_h, stride_w],
                    pads=pads,
                )
            )
        else:
            raise SystemExit(f"Operación no soportada: {kind}")
    outp = graph.Outputs(0)
    nodes.append(helper.make_node("Transpose", [tname(outp)], ["mask"], perm=[0, 2, 3, 1]))
    in_shape = shape(inp)
    out_shape = shape(outp)
    g = helper.make_graph(
        nodes,
        "selfie_segmentation",
        [helper.make_tensor_value_info("input", TensorProto.FLOAT, in_shape)],
        [helper.make_tensor_value_info("mask", TensorProto.FLOAT, out_shape)],
        inits,
    )
    m = helper.make_model(g, opset_imports=[helper.make_opsetid("", 17)], producer_name="content2-tflite-selfie")
    m.ir_version = 8
    onnx.checker.check_model(m)
    dst.write_bytes(m.SerializeToString())


if __name__ == "__main__":
    convert(Path(sys.argv[1]), Path(sys.argv[2]))
    print(f"listo: {sys.argv[2]}")
