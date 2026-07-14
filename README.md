# 밸런스 온 (Balance On)

휴대폰 카메라의 관절 스켈레톤 인식을 활용한 모바일 우선 균형 운동 PWA입니다. 영상은 브라우저 안에서만 분석하며 저장하거나 서버로 전송하지 않습니다.

## MVP

- 한 발 서기: 유지 시간과 몸통 흔들림 기반 안정성 점수
- 무릎 들어 올리기: 좌우 무릎 들기 자동 횟수
- 팔 벌리기: 자세 유지 시간
- MediaPipe Pose Landmarker 기반 33개 관절 스켈레톤
- 기기 내 로컬 운동 기록
- 설치 가능한 웹 앱(PWA) 매니페스트 및 모바일 아이콘

## 실행

```bash
npm install
npm run dev
```

카메라는 보안 컨텍스트에서만 작동합니다. Vercel 배포 또는 `localhost`에서 테스트하세요.

> Google Drive처럼 동기화 중인 폴더에서 npm이 파일 잠금 오류를 낸다면, 저장소를 일반 로컬 폴더에 복제한 뒤 `npm install`을 실행하세요. Vercel 빌드는 이 제약을 받지 않습니다.

## Vercel 배포

1. 이 폴더를 Git 저장소에 올립니다.
2. Vercel에서 해당 저장소를 Import 합니다.
3. Framework Preset은 `Vite`, Build Command는 `npm run build`, Output Directory는 `dist`로 둡니다.
4. Deploy를 누릅니다. 별도의 환경 변수는 필요하지 않습니다.

`vercel.json`에는 카메라 접근을 사이트 자신에게만 허용하는 Permissions-Policy가 포함되어 있습니다.

## 안전 고지

밸런스 온은 일상 운동 안내 도구이며 의료적 진단이나 치료를 제공하지 않습니다. 통증, 어지럼증 또는 낙상 위험이 있으면 운동을 멈추고 의료 전문가와 상담하세요.
