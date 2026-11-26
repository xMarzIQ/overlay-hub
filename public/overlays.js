/*
  Every overlay the hub can run. The OBS page and the hub both read this list.
  To add an overlay later: write its renderer (like scoreboard.js), add it here, add its state on the server,
  and give it a tile and controls in the hub.
*/
(() => {
  'use strict';
  window.OverlayRegistry = {
    canvas: {
      name: 'Canvas',
      mount: (stage, opts) => window.CanvasOverlay.mount(stage, opts),
      normalize: (state) => window.ExtrasModel.canvasNormalize(state),
    },
    desk: {
      name: 'Stream Desk',
      mount: (stage, opts) => window.DeskOverlay.mount(stage, opts),
      normalize: (state) => window.ExtrasModel.deskNormalize(state),
    },
    scoreboard: {
      name: 'Live scoreboard',
      mount: (stage, opts) => window.Scoreboard.mount(stage, opts),
      normalize: (state) => window.Match.normalize(state),
    },
  };
})();
