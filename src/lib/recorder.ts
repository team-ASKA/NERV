/**
 * Minimal PCM recorder for the manual / push-to-talk path (used when VAD is
 * unavailable). Captures mono Float32 samples via an AudioContext so the output
 * can be encoded to WAV for the STT proxy — regardless of MediaRecorder codec
 * support in the browser.
 */

interface AudioContextCtor {
  new (): AudioContext;
}

export class PcmRecorder {
  private ctx: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private chunks: Float32Array[] = [];
  private _sampleRate = 16000;
  private recording = false;

  get isRecording(): boolean {
    return this.recording;
  }

  get sampleRate(): number {
    return this._sampleRate;
  }

  start(stream: MediaStream): void {
    if (this.recording) return;
    const Ctor = (window.AudioContext || (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext) as AudioContextCtor | undefined;
    if (!Ctor) throw new Error('AudioContext unavailable');

    this.ctx = new Ctor();
    this._sampleRate = this.ctx.sampleRate;
    this.chunks = [];
    this.source = this.ctx.createMediaStreamSource(stream);
    this.processor = this.ctx.createScriptProcessor(4096, 1, 1);
    this.processor.onaudioprocess = (e: AudioProcessingEvent) => {
      if (!this.recording) return;
      this.chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
    };
    this.source.connect(this.processor);
    this.processor.connect(this.ctx.destination); // required for the node to run
    this.recording = true;
  }

  /** Stop and return the captured mono PCM plus its sample rate. */
  stop(): { pcm: Float32Array; sampleRate: number } {
    this.recording = false;
    const sampleRate = this._sampleRate;

    try {
      this.processor?.disconnect();
      this.source?.disconnect();
      void this.ctx?.close();
    } catch {
      /* ignore teardown errors */
    }
    this.processor = null;
    this.source = null;
    this.ctx = null;

    const total = this.chunks.reduce((n, c) => n + c.length, 0);
    const pcm = new Float32Array(total);
    let offset = 0;
    for (const c of this.chunks) {
      pcm.set(c, offset);
      offset += c.length;
    }
    this.chunks = [];
    return { pcm, sampleRate };
  }
}
