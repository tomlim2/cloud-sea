import { createScene } from './scene.js';

// ?gl=1 forces the WebGL 2 backend
const query = new URLSearchParams(location.search);

createScene(document.getElementById('stage'), {
  forceWebGL: query.get('gl') === '1',
  onFail: () => (document.getElementById('fail').hidden = false),
  onLook: () => document.getElementById('hint').classList.add('gone'),
}).then((scene) => {
  if (import.meta.env.DEV && scene) window.__cs = scene.debug;
});
