# Modelo de recorte de persona de los efectos

`selfie_segmentation.onnx`: MediaPipe Selfie Segmentation (modelo general 256×256, Google, **Apache-2.0**, ver
`LICENSE-mediapipe.txt`), convertido a ONNX con `scripts/tflite_selfie_to_onnx.py` desde
`selfie_segmentation.tflite` del paquete npm `@mediapipe/selfie_segmentation@0.1.1675465747`
(sha256 del .tflite `8d13b7fae74af625c641226813616a2117bd6bca19eb3b75574621fc08557f27`).

Por qué este modelo y no otro: ver "Efectos de firma → Recorte de la persona" en `docs/worker.md`.
