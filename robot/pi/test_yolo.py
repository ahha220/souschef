from flask import Flask, Response
import cv2
from ultralytics import YOLO

app = Flask(__name__)

# =========================
# 🤖 YOLO MODEL
# =========================
model = YOLO("yolov8n.pt")

cap = cv2.VideoCapture(0)

# 🔥 LOWER RESOLUTION (speed boost)
cap.set(3, 320)
cap.set(4, 240)

frame_id = 0

# =========================
# 📷 CAMERA ORIENTATION FIX
# =========================
FLIP_MODE = 1   # 1 = mirror (most common)
                # 0 = upside down
                # -1 = both

# =========================
# 🍅 TOMATO DETECTION (FAST CV)
# =========================
def detect_tomato(frame):
    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)

    lower_red1 = (0, 120, 70)
    upper_red1 = (10, 255, 255)

    lower_red2 = (170, 120, 70)
    upper_red2 = (180, 255, 255)

    mask1 = cv2.inRange(hsv, lower_red1, upper_red1)
    mask2 = cv2.inRange(hsv, lower_red2, upper_red2)

    mask = mask1 + mask2

    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
    mask = cv2.morphologyEx(mask, cv2.MORPH_DILATE, kernel)

    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    for cnt in contours:
        area = cv2.contourArea(cnt)

        if area < 2000:
            continue

        x, y, w, h = cv2.boundingRect(cnt)

        cx = x + w // 2
        cy = y + h // 2

        cv2.rectangle(frame, (x, y), (x + w, y + h), (0, 0, 255), 2)
        cv2.circle(frame, (cx, cy), 5, (255, 0, 0), -1)

        cv2.putText(frame, "TOMATO", (x, y - 5),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.6, (0, 0, 255), 2)

        return frame, (cx, cy)

    return frame, None


# =========================
# 🌐 STREAM FUNCTION
# =========================
def stream():
    global frame_id

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        # =========================
        # 📷 FIX CAMERA ORIENTATION
        # =========================
        frame = cv2.flip(frame, FLIP_MODE)

        frame_id += 1

        # =========================
        # 🍅 TOMATO DETECTION (FAST EVERY FRAME)
        # =========================
        frame, tomato_center = detect_tomato(frame)

        if tomato_center:
            cx, cy = tomato_center
            # robot use later:
            # error_x = cx - 160

        # =========================
        # 🤖 YOLO (SLOW EVERY 8 FRAMES)
        # =========================
        if frame_id % 8 == 0:
            results = model(frame, imgsz=160, conf=0.4, verbose=False)

            for box in results[0].boxes:
                cls_id = int(box.cls[0])
                name = model.names[cls_id]

                if name not in ["knife", "bowl"]:
                    continue

                x1, y1, x2, y2 = map(int, box.xyxy[0])

                cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 255, 0), 2)

                cx = (x1 + x2) // 2
                cy = (y1 + y2) // 2

                cv2.circle(frame, (cx, cy), 4, (0, 255, 255), -1)

                cv2.putText(frame, name, (x1, y1 - 5),
                            cv2.FONT_HERSHEY_SIMPLEX,
                            0.5, (0, 255, 0), 2)

        # =========================
        # 📊 CENTER GUIDE (ROBOT ALIGNMENT)
        # =========================
        h, w = frame.shape[:2]
        cv2.line(frame, (w//2, 0), (w//2, h), (255, 255, 0), 1)
        cv2.line(frame, (0, h//2), (w, h//2), (255, 255, 0), 1)

        # =========================
        # 📡 STREAM OUTPUT
        # =========================
        _, buffer = cv2.imencode('.jpg', frame,
                                 [cv2.IMWRITE_JPEG_QUALITY, 60])

        frame = buffer.tobytes()

        yield (b'--frame\r\n'
               b'Content-Type: image/jpeg\r\n\r\n' + frame + b'\r\n')


# =========================
# 🌐 FLASK ROUTE
# =========================
@app.route('/video')
def video():
    return Response(stream(),
                    mimetype='multipart/x-mixed-replace; boundary=frame')


app.run(host='0.0.0.0', port=5000)