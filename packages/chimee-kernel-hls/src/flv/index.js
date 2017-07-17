import {CustEvent} from 'chimee-helper';
import MseContriller from './core/mse-controller';
import Transmuxer from './core/transmuxer';
import defaultConfig from './config';
import {throttle, deepAssign, Log} from 'chimee-helper';
/**
 * flv 控制层
 *
 * @export
 * @class mp4
 */
export default class Flv extends CustEvent {
	constructor (videodom, config) {
    super();
    this.tag = 'FLV-player';
    this.video = videodom;
    this.box = 'flv';
    this.config = defaultConfig;
    this.timer = null;
    deepAssign(this.config, config);
    this.requestSetTime = false;
    this.bindEvents();
    this.attachMedia();
  }

  internalPropertyHandle () {
    if(!Object.getOwnPropertyDescriptor) {
      return;
    }
    const _this = this;
    const time = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime');

    Object.defineProperty(this.video, 'currentTime', {
      get: ()=> {
        return time.get.call(_this.video);
      },
      set: (t)=> {
        if(!_this.currentTimeLock) {
          throw new Error('can not set currentTime by youself');
        } else {
          return time.set.call(_this.video, t);
        }
      }
    });
  }

  bindEvents () {
    if(this.video) {
      this.video.addEventListener('canplay', () => {
        if(this.config.type === 'live') {
          this.video.play();
        }
        if(this.config.lockInternalProperty) {
          this.internalPropertyHandle();
        }
      });
    }
  }

  attachMedia () {
    this.mediaSource = new MseContriller(this.video, this.config);
    this.mediaSource.on('source_open', ()=>{
      this.transmuxer.loadSource();
    });
    this.mediaSource.on('bufferFull', ()=>{
      this.pauseTransmuxer();
    });
    this.mediaSource.on('mediaInfo', (mediaInfo)=>{
      this.emit('mediaInfo', mediaInfo);
    });
    this.mediaSource.on('updateend', this.onmseUpdateEnd.bind(this));
  }

  load () {
    this.video.src = URL.createObjectURL(this.mediaSource.mediaSource);
    this.video.addEventListener('seeking', throttle(this._seek.bind(this), 200, {leading: false}));
    this.transmuxer = new Transmuxer(this.mediaSource, this.config);
    this.transmuxer.on('mediaSegment', (handle)=> {
      this.mediaSource.emit('mediaSegment', handle.data);
    });
    this.transmuxer.on('mediaSegmentInit', (handle)=> {
      this.mediaSource.emit('mediaSegmentInit', handle.data);
    });
    this.transmuxer.on('error', (handle)=> {
      this.emit('error', handle.data);
    });
  }

  isTimeinBuffered (seconds) {
    const buffered = this.video.buffered;
    for (let i = 0; i < buffered.length; i++) {
        const from = buffered.start(i);
        const to = buffered.end(i);
        if (seconds >= from && seconds < to) {
            return true;
        }
    }
    return false;
  }

  getCurrentBufferEnd () {
    const buffered = this.video.buffered;
    const currentTime = this.video.currentTime;
    let currentRangeEnd = 0;

    for (let i = 0; i < buffered.length; i++) {
      const start = buffered.start(i);
      const end = buffered.end(i);
      if (start <= currentTime && currentTime < end) {
        currentRangeEnd = end;
        return currentRangeEnd;
      }
    }
  }

  _seek (e, seconds) {
    this.currentTimeLock = true;
    this.timer = null;

    let currentTime = seconds ? seconds : this.video.currentTime;
    if(this.requestSetTime) {
      this.requestSetTime = false;
      this.currentTimeLock = false;
      return;
    }
    // const buffered = this.video.buffered;
    if(this.isTimeinBuffered(currentTime)) {
      if(this.config.alwaysSeekKeyframe) {
        const nearlestkeyframe = this.transmuxer.getNearlestKeyframe(Math.floor(currentTime * 1000));
        if (nearlestkeyframe) {
          this.requestSetTime = true;
          this.video.currentTime = nearlestkeyframe.keyframetime / 1000;
        }
      }
    } else {
      this.transmuxer.pause();
      const nearlestkeyframe = this.transmuxer.getNearlestKeyframe(Math.floor(currentTime * 1000));
      currentTime = nearlestkeyframe.keyframetime / 1000;
      this.transmuxer.seek(nearlestkeyframe);
      this.mediaSource.seek(currentTime);
      this.requestSetTime = true;
      this.video.currentTime = currentTime;
      window.clearInterval(this.timer);
      this.timer = null;
    }
    this.currentTimeLock = false;
    return currentTime;
  }

  onmseUpdateEnd () {
    if (this.config.isLive) {
      return;
    }
    const currentBufferEnd = this.getCurrentBufferEnd();
    const currentTime = this.video.currentTime;
    if (currentBufferEnd >= currentTime + this.config.lazyLoadMaxDuration && this.timer === null) {
        Log.verbose(this.tag, 'Maximum buffering duration exceeded, suspend transmuxing task');
        this.pauseTransmuxer();
    }
  }

  heartbeat () {
    const currentTime = this.video.currentTime;
    const buffered = this.video.buffered;

    let needResume = false;

    for (let i = 0; i < buffered.length; i++) {
      const from = buffered.start(i);
      const to = buffered.end(i);
      if (currentTime >= from && currentTime < to) {
        if (currentTime >= to - this.config.lazyLoadRecoverDuration) {
          needResume = true;
        }
        break;
      }
    }

    if (needResume) {
      window.clearInterval(this.timer);
      this.timer = null;
      Log.verbose(this.TAG, 'Continue loading from paused position');
      this.transmuxer.resume();
    }
  }

  pauseTransmuxer () {
    this.transmuxer.pause();
    if(!this.timer) {
      this.timer = setInterval(this.heartbeat.bind(this), 1000);
    }
  }

  resume () {

  }

  destroy () {
    if(this.video) {
      this.video.src = '';
      this.video.removeAttribute('src');
      this.transmuxer.destroy();
      this.transmuxer = null;
      this.mediaSource.destroy();
      this.mediaSource = null;
    }
  }

  seek (seconds) {
    // throttle(this._seek.bind(this, seconds), 200, {leading: false});
    return this._seek(null, seconds);
  }

  play () {
    return this.video.play();
  }

  pause () {
    return this.video.pause();
  }
}