import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { FilesetResolver, PoseLandmarker } from "@mediapipe/tasks-vision";
import "./styles.css";

const EXERCISES = [
  { id: "balance", emoji: "⚖", name: "한 발 서기", description: "한쪽 발을 들고 시선은 정면에 둬요.", unit: "초" },
  { id: "knee", emoji: "◒", name: "제자리 무릎 들기", description: "제자리에서 무릎을 천천히 허리 높이까지 올려요.", unit: "회" },
  { id: "arms", emoji: "⌁", name: "팔 벌리기", description: "양팔을 어깨 높이에서 넓게 펼쳐요.", unit: "초" },
  { id: "squat", emoji: "⌄", name: "균형 스쿼트", description: "엉덩이를 뒤로 보내며 천천히 앉았다 일어나요.", unit: "회" },
  { id: "shift", emoji: "↔", name: "체중 이동", description: "발은 고정하고 중심을 좌우로 천천히 옮겨요.", unit: "회" },
  { id: "heel", emoji: "↑", name: "뒤꿈치 들기", description: "발끝은 바닥에 두고 뒤꿈치를 천천히 들어요.", unit: "회" },
];

const CONNECTIONS = [
  [0, 11], [0, 12], [11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24],
  [23, 24], [23, 25], [25, 27], [24, 26], [26, 28],
];

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
const average = (numbers) => numbers.reduce((total, number) => total + number, 0) / Math.max(numbers.length, 1);
const jointAngle = (first, joint, last) => {
  const firstVector = { x: first.x - joint.x, y: first.y - joint.y };
  const lastVector = { x: last.x - joint.x, y: last.y - joint.y };
  const dot = firstVector.x * lastVector.x + firstVector.y * lastVector.y;
  const magnitude = Math.hypot(firstVector.x, firstVector.y) * Math.hypot(lastVector.x, lastVector.y);
  return Math.acos(clamp(dot / Math.max(magnitude, 0.0001), -1, 1)) * (180 / Math.PI);
};
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
  const squatDownRef = useRef(false);
  const squatRepRef = useRef(0);
  const squatSetRef = useRef(1);
  const squatCompleteRef = useRef(false);
  const shiftBaselineRef = useRef(null);
  const shiftSideRef = useRef(null);
  const heelBaselineRef = useRef(null);
  const heelUpRef = useRef(false);
  const pausedAtRef = useRef(null);
  const pausedDurationRef = useRef(0);
  const autoPausedRef = useRef(false);
  const activeRef = useRef(false);
  const exerciseRef = useRef("balance");
  const lastHudRef = useRef(0);

  const [exerciseId, setExerciseId] = useState("balance");
  const [cameraState, setCameraState] = useState("idle");
  const [status, setStatus] = useState("카메라를 켜고 전신이 보이게 서 주세요.");
  const [isActive, setIsActive] = useState(false);
  const [isAutoPaused, setIsAutoPaused] = useState(false);
  const [squatRepsTarget, setSquatRepsTarget] = useState(10);
  const [squatSetsTarget, setSquatSetsTarget] = useState(3);
  const [squatRep, setSquatRep] = useState(0);
  const [squatSet, setSquatSet] = useState(1);
  const [squatPulse, setSquatPulse] = useState(0);
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
    squatDownRef.current = false;
    squatRepRef.current = 0;
    squatSetRef.current = 1;
    squatCompleteRef.current = false;
    shiftBaselineRef.current = null;
    shiftSideRef.current = null;
    heelBaselineRef.current = null;
    heelUpRef.current = false;
    pausedAtRef.current = null;
    pausedDurationRef.current = 0;
    autoPausedRef.current = false;
    activeRef.current = false;
    setIsActive(false);
    setIsAutoPaused(false);
    setSquatRep(0);
    setSquatSet(1);
    setSquatPulse(0);
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

  const autoPauseForFrame = (now = performance.now()) => {
    if (activeRef.current && !autoPausedRef.current) {
      autoPausedRef.current = true;
      pausedAtRef.current = now;
      setIsAutoPaused(true);
      setStatus("전신이 프레임 안에 보이게 휴대폰을 조금 멀리 놓아 주세요. 자동 일시정지 중이에요.");
      return;
    }
    if (!activeRef.current) setStatus("전신이 프레임 안에 보이게 휴대폰을 조금 멀리 놓아 주세요.");
  };

  const resumeAfterFrameRecovery = (now) => {
    if (!activeRef.current || !autoPausedRef.current) return;
    pausedDurationRef.current += now - pausedAtRef.current;
    pausedAtRef.current = null;
    autoPausedRef.current = false;
    setIsAutoPaused(false);
    setStatus("전신이 다시 확인되어 운동을 자동 재개했어요.");
  };

  const updateExercise = (points) => {
    const leftHip = points[23], rightHip = points[24], leftKnee = points[25], rightKnee = points[26];
    const leftAnkle = points[27], rightAnkle = points[28], leftWrist = points[15], rightWrist = points[16];
    const leftShoulder = points[11], rightShoulder = points[12];
    const now = performance.now();
    if (![leftHip, rightHip, leftKnee, rightKnee, leftAnkle, rightAnkle, leftWrist, rightWrist, leftShoulder, rightShoulder].every((point) => point.visibility > 0.45)) {
      autoPauseForFrame(now);
      return;
    }
    resumeAfterFrameRecovery(now);
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
    const elapsed = (now - sessionStartRef.current - pausedDurationRef.current) / 1000;
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
    if (exerciseRef.current === "squat") {
      const kneeAngle = average([
        jointAngle(leftHip, leftKnee, leftAnkle),
        jointAngle(rightHip, rightKnee, rightAnkle),
      ]);
      if (squatCompleteRef.current) {
        setStatus("모든 세트를 완료했어요! 종료를 눌러 기록을 저장하세요.");
      } else if (kneeAngle < 125) {
        squatDownRef.current = true;
        setStatus("좋아요. 무릎이 발끝보다 너무 앞으로 나가지 않게 유지해요.");
      } else if (squatDownRef.current && kneeAngle > 155) {
        squatDownRef.current = false;
        const nextRep = squatRepRef.current + 1;
        squatRepRef.current = nextRep;
        setMetric((count) => count + 1);
        setSquatRep(nextRep);
        setSquatPulse((count) => count + 1);
        if (nextRep >= squatRepsTarget) {
          if (squatSetRef.current >= squatSetsTarget) {
            squatCompleteRef.current = true;
            setStatus("목표 세트를 모두 완료했어요! 정말 잘했어요.");
          } else {
            squatSetRef.current += 1;
            squatRepRef.current = 0;
            setSquatSet(squatSetRef.current);
            setSquatRep(0);
            setStatus(`${squatSetRef.current - 1}세트 완료! 숨을 고르고 다음 세트를 시작하세요.`);
          }
        } else {
          setStatus("안정적인 한 회예요. 천천히 다음 동작으로 이어가요.");
        }
      } else {
        setStatus("엉덩이를 뒤로 보내며 천천히 내려가세요.");
      }
    }
    if (exerciseRef.current === "shift") {
      const hipCenter = (leftHip.x + rightHip.x) / 2;
      if (shiftBaselineRef.current === null) shiftBaselineRef.current = hipCenter;
      const offset = hipCenter - shiftBaselineRef.current;
      const side = offset > 0.045 ? "right" : offset < -0.045 ? "left" : null;
      if (side && side !== shiftSideRef.current) {
        shiftSideRef.current = side;
        setMetric((count) => count + 1);
      }
      if (!side) shiftBaselineRef.current = hipCenter;
      setStatus(side ? "좋아요. 발은 움직이지 말고 반대쪽으로도 천천히 옮겨요." : "발을 고정한 채 중심을 한쪽으로 옮겨 보세요.");
    }
    if (exerciseRef.current === "heel") {
      const ankleHeight = average([leftAnkle.y, rightAnkle.y]);
      if (heelBaselineRef.current === null) heelBaselineRef.current = ankleHeight;
      const heelsRaised = ankleHeight < heelBaselineRef.current - 0.025;
      if (heelsRaised) {
        heelUpRef.current = true;
        setStatus("좋아요. 정점에서 잠시 멈췄다가 천천히 내려요.");
      } else if (heelUpRef.current) {
        heelUpRef.current = false;
        heelBaselineRef.current = ankleHeight;
        setMetric((count) => count + 1);
        setStatus("한 회 완료! 발끝은 바닥에 고정해요.");
      } else {
        heelBaselineRef.current = ankleHeight;
        setStatus("발끝을 바닥에 두고 뒤꿈치를 천천히 들어 올리세요.");
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
        autoPauseForFrame(performance.now());
      }
    }
    animationRef.current = requestAnimationFrame(detectFrame);
  };

  const beginSession = () => {
    resetSession();
    sessionStartRef.current = performance.now();
    activeRef.current = true;
    setIsActive(true);
    setStatus(exercise.description);
  };

  const finishSession = () => {
    if (!isActive) return;
    const entry = { id: `${Date.now()}`, date: todayKey(), exerciseId, metric, stability, seconds };
    const next = [entry, ...history].slice(0, 30);
    localStorage.setItem("balance-on-history", JSON.stringify(next));
    setHistory(next);
    activeRef.current = false;
    setIsActive(false);
    setStatus(`${metric}${exercise.unit} 기록 완료! 오늘도 중심을 잘 잡았어요.`);
  };

  const dailyScore = history.filter((entry) => entry.date === todayKey()).reduce((sum, entry) => sum + entry.stability, 0);
  const todayCount = history.filter((entry) => entry.date === todayKey()).length;

  return (
    <main className={`app-shell ${cameraState === "ready" ? "camera-active" : ""} ${isActive ? "session-running" : ""} ${isAutoPaused ? "auto-paused" : ""}`}>
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

      {exerciseId === "squat" && <section className="squat-setup" aria-label="스쿼트 목표 설정">
        <div className="setup-copy"><span>균형 스쿼트</span><strong>목표를 정해 시작하세요</strong></div>
        <div className="setup-control">
          <span>반복</span>
          <button aria-label="반복 횟수 줄이기" onClick={() => setSquatRepsTarget((value) => Math.max(5, value - 5))}>−</button>
          <b>{squatRepsTarget}<small>회</small></b>
          <button aria-label="반복 횟수 늘리기" onClick={() => setSquatRepsTarget((value) => Math.min(30, value + 5))}>+</button>
        </div>
        <div className="setup-control">
          <span>세트</span>
          <button aria-label="세트 수 줄이기" onClick={() => setSquatSetsTarget((value) => Math.max(1, value - 1))}>−</button>
          <b>{squatSetsTarget}<small>세트</small></b>
          <button aria-label="세트 수 늘리기" onClick={() => setSquatSetsTarget((value) => Math.min(5, value + 1))}>+</button>
        </div>
      </section>}

      <section className="camera-card">
        <div className="camera-stage">
          <video ref={videoRef} muted playsInline className={cameraState === "ready" ? "visible" : ""} />
          <canvas ref={canvasRef} />
          {cameraState !== "ready" && <div className="camera-empty"><span>◌</span><strong>전신이 보이는 곳에<br />휴대폰을 세워 주세요</strong></div>}
          <div className="live-badge"><i /> LIVE</div>
          {cameraState === "ready" && <button className="exit-camera" onClick={closeCamera} aria-label="카메라 닫기">×</button>}
          {cameraState === "ready" && <div className="stability-badge"><small>안정성</small><b>{stability}</b></div>}
          {cameraState === "ready" && exerciseId === "squat" && <div className="squat-counter" key={squatPulse}>
            <span>SET {squatSet} / {squatSetsTarget}</span>
            <strong><b>{squatRep}</b><i>/</i><em>{squatRepsTarget}</em></strong>
          </div>}
        </div>
        <div className="camera-info">
          <div><p>{exercise.name}</p><strong>{metric}<small>{exercise.unit}</small></strong></div>
          <div className="stability-ring" style={{ "--score": `${stability * 3.6}deg` }}><span>{stability || "–"}</span></div>
        </div>
        <p className="coach-message">{status}</p>
        {cameraState !== "ready" ? <button className="primary-button" disabled={cameraState === "loading"} onClick={startCamera}>{cameraState === "loading" ? "카메라 준비 중…" : "카메라 시작하기"} <span>→</span></button>
          : !isActive ? <button className="primary-button session-control" onClick={beginSession}>시작</button>
          : <button className="finish-button session-control" onClick={finishSession}>종료</button>}
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
