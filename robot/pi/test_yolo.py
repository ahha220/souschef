from flask import Flask, Response
import cv2
import numpy as np

app = Flask(__name__)

cap = cv2.VideoCapture(0)
cap.set(3, 320)
cap.set(4, 240)

FLIP_MODE = 1

def draw_target(frame, center, color, label):
    if center is None:
        return frame

    cx, cy = center
    cv2.circle(frame, (cx, cy), 6, color, -1)
    cv2.putText(frame, label, (cx + 6, cy),
                cv2.FONT_HERSHEY_SIMPLEX, 0.45, color, 2)
    return frame


def detect_tomato(frame):
    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
    hue, sat, val = cv2.split(hsv)

    # tighter red hue
    red_mask = (
        cv2.inRange(hue, 0, 10) |
        cv2.inRange(hue, 170, 180)
    )

    # less sensitive to dark/shadow red
    sat_mask = cv2.inRange(sat, 90, 255)
    val_mask = cv2.inRange(val, 70, 255)

    mask = red_mask & sat_mask & val_mask

    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN,
                            np.ones((5,5), np.uint8))

    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL,
                                   cv2.CHAIN_APPROX_SIMPLE)

    for c in contours:
        area = cv2.contourArea(c)

        # reject far tomato & noise
        if area < 1200:
            continue

        x,y,w,h = cv2.boundingRect(c)
        aspect = w / (h + 1e-5)

        if not (0.7 < aspect < 1.3):
            continue

        # circularity check
        peri = cv2.arcLength(c, True)
        circularity = 4 * np.pi * area / (peri * peri + 1e-5)

        if circularity < 0.6:
            continue

        cx, cy = x + w//2, y + h//2
        cv2.rectangle(frame, (x,y), (x+w,y+h), (0,0,255), 2)
        draw_target(frame, (cx,cy), (0,0,255), "TOMATO")

        return frame, (cx,cy)

    return frame, None

def detect_blue_plate(frame):
    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
    h,s,v = cv2.split(hsv)

    blue_mask = cv2.inRange(h, 85, 135)
    sat_mask = cv2.inRange(s, 25, 200)
    val_mask = cv2.inRange(v, 60, 255)

    mask = blue_mask & sat_mask & val_mask

    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN,
                            np.ones((7,7), np.uint8))

    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL,
                                   cv2.CHAIN_APPROX_SIMPLE)

    for c in contours:
        area = cv2.contourArea(c)
        if area < 2500:
            continue

        x,y,w,h = cv2.boundingRect(c)
        aspect = w / (h + 1e-5)

        if not (0.7 < aspect < 1.3):
            continue

        mean_sat = np.mean(s[y:y+h, x:x+w])
        if mean_sat < 30:
            continue

        cx, cy = x + w//2, y + h//2
        cv2.rectangle(frame, (x,y), (x+w,y+h), (255,0,0), 2)
        draw_target(frame, (cx,cy), (255,0,0), "PLATE")

        return frame, (cx,cy)

    return frame, None


def stream():
    while True:
        ret, frame = cap.read()
        if not ret:
            break

        frame = cv2.flip(frame, FLIP_MODE)

        frame, _ = detect_tomato(frame)
        frame, _ = detect_blue_plate(frame)

        _, buffer = cv2.imencode('.jpg', frame,
                                 [cv2.IMWRITE_JPEG_QUALITY, 60])

        yield (b'--frame\r\n'
               b'Content-Type: image/jpeg\r\n\r\n' +
               buffer.tobytes() + b'\r\n')

@app.route('/video')
def video():
    return Response(stream(),
                    mimetype='multipart/x-mixed-replace; boundary=frame')

app.run(host='0.0.0.0', port=5000)