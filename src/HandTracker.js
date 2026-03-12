import React, { useEffect, useRef } from 'react';
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';

const SMOOTH_ALPHA = 0.3;
const PINCH_ON = 0.045;
const PINCH_OFF = 0.075;

const CONNECTIONS = [
  [0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],
  [0,9],[9,10],[10,11],[11,12],[0,13],[13,14],[14,15],[15,16],
  [0,17],[17,18],[18,19],[19,20],
];

export default function HandTracker({ onHandData, rotated, mobileScale }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const callbackRef = useRef(onHandData);
  const rotatedRef = useRef(rotated);
  const mobileScaleRef = useRef(mobileScale);
  const pinchStateRef = useRef([false, false]);
  const smoothRef = useRef([
    { x: 0, y: 0, initialized: false },
    { x: 0, y: 0, initialized: false },
  ]);
  const landmarkerRef = useRef(null);
  const rafRef = useRef(null);
  const lastTimeRef = useRef(-1);

  useEffect(() => { callbackRef.current = onHandData; }, [onHandData]);
  useEffect(() => { rotatedRef.current = rotated; }, [rotated]);
  useEffect(() => { mobileScaleRef.current = mobileScale; }, [mobileScale]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let cancelled = false;

    async function setup() {
      const vision = await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
      );
      if (cancelled) return;

      const handLandmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
          delegate: 'GPU',
        },
        runningMode: 'VIDEO',
        numHands: 2,
        minHandDetectionConfidence: 0.6,
        minHandPresenceConfidence: 0.6,
        minTrackingConfidence: 0.6,
      });
      if (cancelled) return;
      landmarkerRef.current = handLandmarker;

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: 'user' },
      });
      if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
      video.srcObject = stream;
      await video.play();

      function detect() {
        if (cancelled) return;
        rafRef.current = requestAnimationFrame(detect);

        if (!video.videoWidth || !video.videoHeight) return;
        const now = performance.now();
        if (now === lastTimeRef.current) return;
        lastTimeRef.current = now;

        const results = handLandmarker.detectForVideo(video, now);

        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        // In rotated mode, the container is 100vh wide x 100vw tall
        const isRot = rotatedRef.current;
        const screenW = isRot ? window.innerHeight : window.innerWidth;
        const screenH = isRot ? window.innerWidth : window.innerHeight;
        canvas.width = screenW;
        canvas.height = screenH;
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const xRatio = screenW / video.videoWidth;
        const yRatio = screenH / video.videoHeight;

        if (!results.landmarks || results.landmarks.length === 0) {
          smoothRef.current[0].initialized = false;
          smoothRef.current[1].initialized = false;
          pinchStateRef.current = [false, false];
          if (callbackRef.current) callbackRef.current([]);
          return;
        }

        const handsData = [];

        results.landmarks.forEach((landmarks, handIndex) => {
          const indexTip = landmarks[8];
          const thumbTip = landmarks[4];

          const rawX = (1 - indexTip.x) * video.videoWidth * xRatio;
          const rawY = indexTip.y * video.videoHeight * yRatio;

          const sm = smoothRef.current[handIndex];
          if (!sm.initialized) { sm.x = rawX; sm.y = rawY; sm.initialized = true; }
          else { sm.x += SMOOTH_ALPHA * (rawX - sm.x); sm.y += SMOOTH_ALPHA * (rawY - sm.y); }

          const pinchDistance = Math.hypot(indexTip.x - thumbTip.x, indexTip.y - thumbTip.y);
          const wasPinching = pinchStateRef.current[handIndex];
          const isPinched = wasPinching ? pinchDistance < PINCH_OFF : pinchDistance < PINCH_ON;
          pinchStateRef.current[handIndex] = isPinched;

          const pinchAngle = Math.atan2(
            thumbTip.y - indexTip.y,
            (1 - thumbTip.x) - (1 - indexTip.x)
          );

          // On mobile, amplify coordinates from center so hand range covers full controller
          const ms = mobileScaleRef.current;
          const amp = ms < 1 ? 1 / ms : 1;
          const cX = screenW / 2, cY = screenH / 2;
          const ampX = (x) => amp === 1 ? x : cX + (x - cX) * amp;
          const ampY = (y) => amp === 1 ? y : cY + (y - cY) * amp;

          handsData.push({
            x: ampX(sm.x), y: ampY(sm.y),
            pinching: isPinched,
            justPinched: isPinched && !wasPinching,
            justReleased: !isPinched && wasPinching,
            pinchAngle,
          });

          // Convert landmarks to screen coords (with mobile amplification)
          const pts = landmarks.map((lm) => ({
            x: ampX((1 - lm.x) * video.videoWidth * xRatio),
            y: ampY(lm.y * video.videoHeight * yRatio),
          }));

          // Draw semi-transparent hand silhouette
          const palmIndices = [0, 1, 5, 9, 13, 17];
          ctx.beginPath();
          ctx.moveTo(pts[palmIndices[0]].x, pts[palmIndices[0]].y);
          palmIndices.forEach((pi) => ctx.lineTo(pts[pi].x, pts[pi].y));
          ctx.closePath();
          ctx.fillStyle = isPinched ? 'rgba(232,100,12,0.15)' : 'rgba(100,100,100,0.15)';
          ctx.fill();

          // Draw finger fills
          const fingers = [[1,2,3,4],[5,6,7,8],[9,10,11,12],[13,14,15,16],[17,18,19,20]];
          fingers.forEach((f) => {
            ctx.beginPath();
            ctx.moveTo(pts[f[0]].x, pts[f[0]].y);
            f.forEach((fi) => ctx.lineTo(pts[fi].x, pts[fi].y));
            ctx.lineWidth = isPinched ? 16 : 20;
            ctx.lineCap = 'round'; ctx.lineJoin = 'round';
            ctx.strokeStyle = isPinched ? 'rgba(232,100,12,0.12)' : 'rgba(100,100,100,0.12)';
            ctx.stroke();
          });

          // Draw wireframe connections
          CONNECTIONS.forEach(([i, j]) => {
            ctx.beginPath(); ctx.moveTo(pts[i].x, pts[i].y); ctx.lineTo(pts[j].x, pts[j].y);
            ctx.strokeStyle = isPinched ? 'rgba(232,100,12,0.35)' : 'rgba(140,140,140,0.2)';
            ctx.lineWidth = 1.5; ctx.lineCap = 'round'; ctx.stroke();
          });

          // Draw landmark dots
          pts.forEach((pt) => {
            ctx.beginPath(); ctx.arc(pt.x, pt.y, 3, 0, 2 * Math.PI);
            ctx.fillStyle = isPinched ? 'rgba(232,100,12,0.7)' : 'rgba(160,160,160,0.4)';
            ctx.fill();
          });
        });

        if (callbackRef.current) callbackRef.current(handsData);
      }

      detect();
    }

    setup();

    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (landmarkerRef.current) landmarkerRef.current.close();
      if (video.srcObject) {
        video.srcObject.getTracks().forEach(t => t.stop());
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <video ref={videoRef} autoPlay playsInline muted className="webcam-preview" />
      <canvas ref={canvasRef} style={{ position:'absolute', top:0, left:0, width:'100%', height:'100%', zIndex:500, pointerEvents:'none' }} />
    </>
  );
}
