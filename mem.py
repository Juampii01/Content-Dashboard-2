import resource, sys, time
import numpy as np, onnxruntime as ort
variant = sys.argv[1]
o = ort.SessionOptions()
if variant in ("basic", "basic-noarena"):
    o.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_BASIC
else:
    o.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
if variant.endswith("noarena"):
    o.enable_cpu_mem_arena = False
    o.enable_mem_pattern = False
s = ort.InferenceSession("modelo/htdemucs_fp16weights.onnx", sess_options=o, providers=["CPUExecutionProvider"])
load = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss // 1024
x = np.random.default_rng(0).uniform(-0.3, 0.3, (1, 2, 343980)).astype(np.float32)
t = time.time()
for _ in range(3):
    s.run(["stems"], {"mix": x})
print(variant, "carga MB", load, "pico MB", resource.getrusage(resource.RUSAGE_SELF).ru_maxrss // 1024, "s/tramo", round((time.time() - t) / 3, 2), flush=True)
