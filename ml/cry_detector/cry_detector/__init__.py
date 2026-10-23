"""On-device baby cry detection spike: offline evaluation harness (no audio is ever recorded by this code)."""

SAMPLE_RATE = 16_000
# MediaPipe's YAMNet task classifies consecutive, non-overlapping windows of 15600 samples (0.975 s).
WINDOW = 15_600
HOP_S = WINDOW / SAMPLE_RATE
