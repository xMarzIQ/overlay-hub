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
    twitch: {
      name: 'Twitch Centre',
      mount: (stage, opts) => window.TwitchOverlay.mount(stage, opts),
      normalize: (state) => window.ExtrasModel.twitchNormalize(state),
    },
    subathon: {
      name: 'Subathon & Goals',
      mount: (stage, opts) => window.SubathonOverlay.mount(stage, opts),
      normalize: (state) => window.ExtrasModel.subathonNormalize(state),
    },
    media: {
      name: 'Media Centre',
      mount: (stage, opts) => window.MediaOverlay.mount(stage, opts),
      normalize: (state) => window.ExtrasModel.mediaNormalize(state),
    },
    challenges: {
      name: 'Challenges',
      mount: (stage, opts) => window.ChallengesOverlay.mount(stage, opts),
      normalize: (state) => window.ExtrasModel.challengesNormalize(state),
    },
    games: {
      name: 'Chat Games',
      mount: (stage, opts) => window.GamesOverlay.mount(stage, opts),
      normalize: (state) => window.ExtrasModel.gamesNormalize(state),
    },
    scoreboard: {
      name: 'Live scoreboard',
      mount: (stage, opts) => window.Scoreboard.mount(stage, opts),
      normalize: (state) => window.Match.normalize(state),
    },
  };
})();
