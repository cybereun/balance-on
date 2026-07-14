import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { FilesetResolver, PoseLandmarker } from "@mediapipe/tasks-vision";
import "./styles.css";

const EXERCISES = [
  { id: "balance", emoji: "⚖", name: "한 발 서기", description: "한쪽 발을 들고 시선은 정면에 둬요.", unit: "초" },
  { id: "knee", emoji: "◒", name: "무릎 들어 올리기", description: "무릎을 천천히 허리 높이까지 올려요.", unit: "회" },
  { id: "arms", emoji: "⌁", name: "팔 벌리기", description: "양팔을 어깨 높이에서 넓게 펼쳐요.", unit: "초" },
];

const CONNECTIONS = [
  [0, 11], [0, 12], [11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24],
  [23, 24], [23, 25], [25, 27], [24, 26], [26, 28],
];

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
const average = (numbers) => numbers.reduce((total, number) => total + number, 0) / Math.max(numbers.length, 1);
const todayKey = () => new Date().toISOString().slice(0, 10);

function App() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const landmarkerRef = useRef(null);
  const animationRef = useRef(null);
  const sessionStartRef = useRef(null);
  const lastTimeRef = useRef(0);
  const movementRef = useRef([]);
  const kneeUpRef = useRef(false);
  const activeRef = useRef(false);
  const exerciseRef = useRef("balance");
  const lastHudRef = useRef(0);

  const [exerciseId, setExerciseId] = useState("balance");
  const [cameraState, setCameraState] = useState("idle");
  const [status, setStatus] = useState("카메라를 켜고 전신이 보이게 서 주세요.");
  const [isActive, setIsActive] = useState(false);
  const [metric, setMetric] = useState(0);
  const [stability, setStability] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [history, setHistory] = useState(() => JSON.parse(localStorage.getItem("balance-on-history") || "[]"));

  const exercise = EXERCISES.find((item) => item.id === exerciseId);

  useEffect(() => {
    activeRef.current = isActive;
  }, [isActive]);

  useEffect(() => {
    exerciseRef.current = exerciseId;
  }, [exerciseId]);

  useEffect(() => {
    return () => stopCamera();
  }, []);

  useEffect(() => {
    resetSession();
    setStatus(cameraState === "ready" ? exercise.description : "카메라를 켜고 전신이 보이게 서 주세요.");
  }, [exerciseId]);

  const resetSession = () => {
    sessionStartRef.current = null;
    movementRef.current = [];
    kneeUpRef.current = false;
    setIsActive(false);
    setMetric(0);
    setStability(0);
    setSeconds(0);
  };

  const stopCamera = () => {
    cancelAnimationFrame(animationRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    landmarkerRef.current?.close();
    landmarkerRef.current = null;
  };

  const closeCamera = () => {
    stopCamera();
    resetSession();
    setCameraState("idle");
    setStatus("카메라를 켜고 전신이 보이게 서 주세요.");
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  };

  const setupLandmarker = async () => {
    const vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32/wasm"
    );
    return PoseLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task",
        delegate: "GPU",
      },
      runningMode: "VIDEO",
      numPoses: 1,
      minPoseDetectionConfidence: 0.55,
      minPosePresenceConfidence: 0.55,
      minTrackingConfidence: 0.5,
    });
  };

  const startCamera = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraState("error");
      setStatus("이 브라우저에서는 카메라를 사용할 수 없어요. HTTPS 환경에서 열어 주세요.");
      return;
    }
    document.documentElement.requestFullscreen?.().catch(() => {});
    setCameraState("loading");
    setStatus("관절 인식기를 준비하는 중이에요…");
    try {
      landmarkerRef.current = await setupLandmarker();
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      setCameraState("ready");
      setStatus(exercise.description);
      detectFrame();
    } catch (error) {
      console.error(error);
      stopCamera();
      setCameraState("error");
      setStatus("카메라를 시작하지 못했어요. 권한을 허용하고 다시 시도해 주세요.");
    }
  };

  const drawPose = (landmarks) => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#6ff5d7";
    ctx.lineWidth = Math.max(4, canvas.width / 170);
    ctx.shadowColor = "#5effd7";
    ctx.shadowBlur = 12;
    ctx.beginPath();
    CONNECTIONS.forEach(([from, to]) => {
      const start = landmarks[from];
      const end = landmarks[to];
      if (!start || !end || start.visibility < 0.42 || end.visibility < 0.42) return;
      ctx.moveTo(start.x * canvas.width, start.y * canvas.height);
      ctx.lineTo(end.x * canvas.width, end.y * canvas.height);
    });
    ctx.stroke();
    ctx.shadowBlur = 0;
    landmarks.forEach((point) => {
      if (point.visibility < 0.42) return;
      const x = point.x * canvas.width;
      const y = point.y * canvas.height;
      const radius = Math.max(5, canvas.width / 115);
      ctx.fillStyle = "#161c55";
      ctx.beginPath();
      ctx.arc(x, y, radius + 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#c3aaff";
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    });
  };

  const updateExercise = (points) => {
    const leftHip = points[23], rightHip = points[24], leftKnee = points[25], rightKnee = points[26];
    const leftAnkle = points[27], rightAnkle = points[28], leftWrist = points[15], rightWrist = points[16];
    const leftShoulder = points[11], rightShoulder = points[12];
    if (![leftHip, rightHip, leftKnee, rightKnee, leftAnkle, rightAnkle, leftWrist, rightWrist, leftShoulder, rightShoulder].every((point) => point.visibility > 0.45)) {
      setStatus("전신이 프레임 안에 보이게 휴대폰을 조금 멀리 놓아 주세요.");
      return;
    }
    const now = performance.now();
    const hipX = (leftHip.x + rightHip.x) / 2;
    movementRef.current = [...movementRef.current.slice(-34), hipX];
    const sway = movementRef.current.length > 8
      ? Math.sqrt(average(movementRef.current.map((x) => (x - average(movementRef.current)) ** 2)))
      : 0;
    const score = clamp(Math.round(100 - sway * 1500), 0, 100);
    const shouldPaintHud = now - lastHudRef.current > 120;
    if (shouldPaintHud) {
      lastHudRef.current = now;
      setStability(score);
    }

    if (!activeRef.current) return;
    const elapsed = (now - sessionStartRef.current) / 1000;
    if (shouldPaintHud) setSeconds(Math.floor(elapsed));

    if (exerciseRef.current === "balance") {
      const oneFootUp = Math.abs(leftAnkle.y - rightAnkle.y) > 0.12;
      if (oneFootUp) {
        if (shouldPaintHud) setMetric(Math.floor(elapsed));
        setStatus(score >= 72 ? "아주 좋아요! 중심을 유지하고 있어요." : "시선은 정면, 복부에 가볍게 힘을 주세요.");
      } else {
        setStatus("한쪽 발을 바닥에서 천천히 들어 올려 주세요.");
      }
    }
    if (exerciseRef.current === "knee") {
      const kneeIsUp = leftKnee.y < leftHip.y - 0.03 || rightKnee.y < rightHip.y - 0.03;
      if (kneeIsUp && !kneeUpRef.current) setMetric((count) => count + 1);
      kneeUpRef.current = kneeIsUp;
      setStatus(kneeIsUp ? "좋아요. 천천히 내렸다가 반대쪽도 올려요." : "무릎을 허리 쪽으로 천천히 올려 주세요.");
    }
    if (exerciseRef.current === "arms") {
      const armsOpen = leftWrist.y < leftShoulder.y + 0.08 && rightWrist.y < rightShoulder.y + 0.08;
      if (armsOpen) {
        if (shouldPaintHud) setMetric(Math.floor(elapsed));
        setStatus("좋아요. 어깨는 편안하게, 팔을 길게 유지해요.");
      } else {
        setStatus("양팔을 어깨 높이까지 넓게 펼쳐 주세요.");
      }
    }
  };

  const detectFrame = () => {
    const video = videoRef.current;
    const landmarker = landmarkerRef.current;
    if (!video || !landmarker || !streamRef.current) return;
    if (video.readyState >= 2 && video.currentTime !== lastTimeRef.current) {
      lastTimeRef.current = video.currentTime;
      const result = landmarker.detectForVideo(video, performance.now());
      if (result.landmarks.length) {
        drawPose(result.landmarks[0]);
        updateExercise(result.landmarks[0]);
      } else {
        const ctx = canvasRef.current?.getContext("2d");
        ctx?.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
        setStatus("카메라 앞에 전신이 보이도록 서 주세요.");
      }
    }
    animationRef.current = requestAnimationFrame(detectFrame);
  };

  const beginSession = () => {
    resetSession();
    sessionStartRef.current = performance.now();
    setIsActive(true);
    setStatus(exercise.description);
  };

  const finishSession = () => {
    if (!isActive) return;
    const entry = { id: `${Date.now()}`, date: todayKey(), exerciseId, metric, stability, seconds };
    const next = [entry, ...history].slice(0, 30);
    localStorage.setItem("balance-on-history", JSON.stringify(next));
    setHistory(next);
    setIsActive(false);
    setStatus(`${metric}${exercise.unit} 기록 완료! 오늘도 중심을 잘 잡았어요.`);
  };

  const dailyScore = history.filter((entry) => entry.date === todayKey()).reduce((sum, entry) => sum + entry.stability, 0);
  const todayCount = history.filter((entry) => entry.date === todayKey()).length;

  return (
    <main className={`app-shell ${cameraState === "ready" ? "camera-active" : ""}`}>
      <header className="topbar">
        <div className="brand"><img src="/icon-192.png" alt="" /><span>밸런스 <b>온</b></span></div>
        <span className="privacy-pill">● 기기 내 분석</span>
      </header>

      <section className="intro">
        <p className="eyebrow">TODAY’S BALANCE</p>
        <h1>내 몸의 중심을<br /><em>매일 3분</em> 확인해요.</h1>
        <p>카메라 영상은 저장하거나 전송하지 않아요.</p>
      </section>

      <section className="exercise-tabs" aria-label="운동 선택">
        {EXERCISES.map((item) => <button key={item.id} className={item.id === exerciseId ? "selected" : ""} onClick={() => setExerciseId(item.id)}>
          <span>{item.emoji}</span>{item.name}
        </button>)}
      </section>

      <section className="camera-card">
        <div className="camera-stage">
          <video ref={videoRef} muted playsInline className={cameraState === "ready" ? "visible" : ""} />
          <canvas ref={canvasRef} />
          {cameraState !== "ready" && <div className="camera-empty"><span>◌</span><strong>전신이 보이는 곳에<br />휴대폰을 세워 주세요</strong></div>}
          <div className="live-badge"><i /> LIVE</div>
          {cameraState === "ready" && <button className="exit-camera" onClick={closeCamera} aria-label="카메라 닫기">×</button>}
          {cameraState === "ready" && <div className="stability-badge"><small>안정성</small><b>{stability}</b></div>}
        </div>
        <div className="camera-info">
          <div><p>{exercise.name}</p><strong>{metric}<small>{exercise.unit}</small></strong></div>
          <div className="stability-ring" style={{ "--score": `${stability * 3.6}deg` }}><span>{stability || "–"}</span></div>
        </div>
        <p className="coach-message">{status}</p>
        {cameraState !== "ready" ? <button className="primary-button" disabled={cameraState === "loading"} onClick={startCamera}>{cameraState === "loading" ? "카메라 준비 중…" : "카메라 시작하기"} <span>→</span></button>
          : !isActive ? <button className="primary-button session-control" onClick={beginSession}>운동 시작 <span>→</span></button>
          : <button className="finish-button session-control" onClick={finishSession}>기록 저장 · 종료</button>}
      </section>

      <section className="mini-stats">
        <div><span>오늘 운동</span><strong>{todayCount}<small>회</small></strong></div>
        <div><span>오늘 누적 점수</span><strong>{dailyScore || "–"}</strong></div>
        <div><span>운동 방식</span><strong className="small-copy">실시간 관절선</strong></div>
      </section>

      <section className="tip-card"><span>✦</span><p><b>더 정확하게 측정하려면</b><br />밝은 곳에서 전신이 보이게 휴대폰을 2~3m 떨어뜨려 세워 주세요.</p></section>
      <p className="disclaimer">밸런스 온은 일상 운동을 돕는 도구이며 의료적 진단이나 치료를 제공하지 않습니다.</p>
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js"));
}
