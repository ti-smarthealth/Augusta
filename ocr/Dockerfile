# tish-ocr — container image for the OCR Lambda.
#
# **A container, not a zip, and ONNX rather than PaddlePaddle.** The PaddleOCR
# models are excellent at Traditional Chinese, but the PaddlePaddle framework
# that normally runs them is over a gigabyte, x86-only in practice, and cold
# starts in the tens of seconds. `rapidocr_onnxruntime` ships the same PP-OCR
# detection/recognition models exported to ONNX and runs them on onnxruntime:
# ~150MB of wheels, arm64 wheels for everything, a 2–3s cold start. The image
# still exceeds the 250MB zip limit, hence the container.
#
# Built for arm64 in CI (deploy-ocr.yml) via buildx; the base image is
# multi-arch. Keep the platform in the build command, not here, so a local
# x86 build for debugging works unchanged.
FROM public.ecr.aws/lambda/python:3.12

# The models load with cv2, which wants these even in headless form.
RUN dnf install -y libglvnd-glx libgomp && dnf clean all

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY rows.py app.py ./

# onnxruntime spawns a thread pool sized to the host; on a 2GB Lambda that is
# two vCPUs and the default is right, but pin it so a memory change does not
# silently change the threading.
ENV OMP_NUM_THREADS=2 \
    HOME=/tmp \
    PYTHONUNBUFFERED=1

CMD ["app.handler"]
