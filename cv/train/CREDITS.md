# Training data credits

Reel's ball / rim / scoreboard detector is trained on these datasets from
Roboflow Universe, each published under CC BY 4.0
(https://creativecommons.org/licenses/by/4.0/):

- **Basketball Detection v6** by Hooper — https://universe.roboflow.com/hooper-ibdsr/basketball-detection-v6
- **basketball detection** by test — https://universe.roboflow.com/test-w6ead/basketball-detection-pymfu
- **Basketball Detection** by Tomas — https://universe.roboflow.com/tomas-34ray/basketball-detection-cjjxp

Changes made: classes remapped to `ball`, `rim`, `scoreboard`; other classes
dropped; the first dataset subsampled.

Model: RF-DETR (Roboflow), Apache License 2.0 — https://github.com/roboflow/rf-detr
