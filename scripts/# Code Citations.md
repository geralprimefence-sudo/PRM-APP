# Code Citations

## License: unknown

[process_ocr.py (GitHub)](https://github.com/Xx-KaAzZ-xX/Perso/tree/f3141eb44c6fbe36f6b604e89dadd8e13b8e419f/Python/process_ocr.py)

```python
def deskew(image):
    coords = np.column_stack(np.where(image > 0))
    angle = cv2.minAreaRect(coords)[-1]
    if angle < -45:
        angle = -(90 + angle)
    else:
        angle = -angle
    (h, w) = image.shape
    return cv2.warpAffine(image, cv2.getRotationMatrix2D((w//2, h//2), angle, 1), (w, h))
```
