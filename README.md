# 구름바다

노을 속 뭉게구름 밭 위를 천천히 날아간다. 해가 지평선에서 떠올라 오후 높이까지 갔다가 다시 내려오는 동안 구름의 빛이 붉은 노을에서 금빛 오후로, 다시 노을로 바뀐다.
three.js의 TSL(Three.js Shading Language)로 쓴 실시간 볼륨 레이마치. WebGPU가 있는 브라우저에서는 WebGPU로, 없으면 WebGL 2로 그린다 (셰이더 한 벌로). 에셋 없음.

https://tomlim2.github.io/cloud-sea/

```bash
npm install
npm run dev
```

마우스를 움직이면 그쪽으로 고개를 돌려 둘러본다. `?gl=1` 을 붙이면 WebGL 2 로 강제.

구조와 그리는 방법은 [MAP.md](MAP.md).

## 참고

[fragcoord.xyz 의 한 셰이더](https://fragcoord.xyz/s/cpwi3i3h)(freeborn, 2026-10)를 보고 같은 방법으로 다시 만들어 본 연습작이다. 구름을 만드는 방법(격자마다 하나씩 선 기둥, 워리 노이즈의 반구 덮개로 만든 꽃양배추 덩어리, 그 위에 억 눌러 놓은 미세한 거품, 채널별 흡수가 있는 빛 수송)은 그 셰이더의 것이고, TSL 로 옮겨 쓰면서 세 가지를 보탰다: 해가 뜨고 지는 하루, 마우스로 둘러보기, 기기에 따라 해상도를 맞추는 것.
