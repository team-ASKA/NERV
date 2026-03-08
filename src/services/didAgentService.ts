/**
 * D-ID Agent Service (Raw WebRTC Implementation)
 *
 * Bypasses the @d-id/client-sdk and "Agent" system to avoid Embedding Limits.
 * Uses the generic talks/streams API to animate a static image with text-to-speech
 * via a standard WebRTC RTCPeerConnection.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export type ConnectionState =
    | 'idle'
    | 'connecting'
    | 'connected'
    | 'disconnected'
    | 'error';

export type VideoState = 'idle' | 'streaming';

export interface DIDAgentCallbacks {
    /** Called when the WebRTC srcObject is ready — attach it to a <video>.srcObject */
    onSrcObjectReady?: (srcObject: MediaStream) => void;
    /** Connection state changes */
    onConnectionStateChange?: (state: ConnectionState) => void;
    /** Video state changes (idle ↔ streaming) */
    onVideoStateChange?: (state: VideoState) => void;
    /** Called when the avatar finishes speaking */
    onSpeechFinished?: () => void;
    /** Errors */
    onError?: (error: string, errorData?: any) => void;
}

// ── Service ──────────────────────────────────────────────────────────────────

class DIDAgentService {
    private peerConnection: RTCPeerConnection | null = null;
    private streamId: string | null = null;
    private sessionId: string | null = null;
    private srcObject: MediaStream | null = null;
    private callbacks: DIDAgentCallbacks = {};
    private _connectionState: ConnectionState = 'idle';
    private _isInitialised = false;
    private apiKey: string | null = null;
    private voiceId = 'en-US-JennyNeural'; // Standard Microsoft Voice

    // Using a more stable D-ID hosted persona image
    private sourceUrl = 'https://create-images-results.d-id.com/DefaultPresenters/Amber_f/v1_image.jpg';

    get connectionState() {
        return this._connectionState;
    }

    /**
     * Initialise the service.
     */
    async initialize(callbacks: DIDAgentCallbacks): Promise<void> {
        this.callbacks = callbacks;
        this.apiKey = import.meta.env.VITE_DID_API_KEY;

        if (!this.apiKey) {
            console.error('[DIDAgentService] VITE_DID_API_KEY is not set in .env');
            callbacks.onError?.('D-ID API Key not configured');
            return;
        }

        this._isInitialised = true;
    }

    /** Connect the stream (starts WebRTC session). */
    async connect(): Promise<void> {
        if (!this._isInitialised || !this.apiKey) {
            console.warn('[DIDAgentService] Service not initialised');
            return;
        }

        try {
            this.updateConnectionState('connecting');

            // 1. Create the Talk Stream
            const streamRes = await fetch('https://api.d-id.com/talks/streams', {
                method: 'POST',
                headers: {
                    'Authorization': `Basic ${this.apiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ source_url: this.sourceUrl }),
            });

            if (!streamRes.ok) throw new Error(await streamRes.text());

            const session = await streamRes.json();
            this.streamId = session.id;
            this.sessionId = session.session_id;

            // 2. Create RTCPeerConnection
            this.peerConnection = new RTCPeerConnection({ iceServers: session.ice_servers });

            // 3. Handle ICE Candidates
            this.peerConnection.onicecandidate = async (event) => {
                if (event.candidate && this.streamId && this.sessionId) {
                    await fetch(`https://api.d-id.com/talks/streams/${this.streamId}/ice`, {
                        method: 'POST',
                        headers: {
                            'Authorization': `Basic ${this.apiKey}`,
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({
                            candidate: event.candidate,
                            session_id: this.sessionId
                        })
                    });
                }
            };

            // 4. Handle Connection State
            this.peerConnection.oniceconnectionstatechange = () => {
                const state = this.peerConnection?.iceConnectionState;
                console.log('[DIDAgentService] ICE Connection state:', state);
                if (state === 'connected' || state === 'completed') {
                    this.updateConnectionState('connected');
                } else if (state === 'failed' || state === 'disconnected' || state === 'closed') {
                    // Only error if it's truly failed, disconnected might just be temporary
                    if (state === 'failed') this.updateConnectionState('error');
                }
            };

            // 5. Handle Incoming Video Track
            this.peerConnection.ontrack = (event) => {
                console.log('[DIDAgentService] Received track:', event.track.kind);
                if (event.track.kind === 'video' || event.track.kind === 'audio') {
                    if (!this.srcObject || this.srcObject.id !== event.streams[0].id) {
                        this.srcObject = event.streams[0];
                        this.callbacks.onSrcObjectReady?.(this.srcObject);
                    }
                }
            };

            // 6. Set Remote Description (D-ID's Offer)
            await this.peerConnection.setRemoteDescription(
                new RTCSessionDescription(session.offer)
            );

            // 7. Create Local Description (Our Answer)
            const answer = await this.peerConnection.createAnswer();
            await this.peerConnection.setLocalDescription(answer);

            // 8. Send Answer to D-ID
            const sdpRes = await fetch(`https://api.d-id.com/talks/streams/${this.streamId}/sdp`, {
                method: 'POST',
                headers: {
                    'Authorization': `Basic ${this.apiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    answer: answer,
                    session_id: this.sessionId
                })
            });

            if (!sdpRes.ok) throw new Error(await sdpRes.text());

        } catch (err: any) {
            console.error('[DIDAgentService] Connect failed:', err);
            this.updateConnectionState('error');
            let errorMsg = 'Failed to connect to D-ID stream';
            if (err.message && err.message.includes('Max user sessions reached')) {
                errorMsg = 'Max sessions reached (due to page reload). Please wait a few minutes for the previous stream to expire on D-ID.';
            }
            this.callbacks.onError?.(errorMsg);
        }
    }

    /**
     * Make the avatar speak specific text.
     */
    async speak(text: string): Promise<void> {
        if (!this.streamId || !this.sessionId || !this.apiKey) {
            console.warn('[DIDAgentService] Cannot speak — stream not established');
            return;
        }
        if (text.length < 3) return;

        try {
            this.callbacks.onVideoStateChange?.('streaming');

            const res = await fetch(`https://api.d-id.com/talks/streams/${this.streamId}`, {
                method: 'POST',
                headers: {
                    'Authorization': `Basic ${this.apiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    script: {
                        type: 'text',
                        input: text,
                        provider: { type: 'microsoft', voice_id: this.voiceId }
                    },
                    session_id: this.sessionId,
                    config: {
                        fluent: true,
                        pad_audio: 0
                    }
                })
            });

            if (!res.ok) throw new Error(await res.text());

            // 5. Success — Estimate duration to trigger finish callback
            // Rough words-per-minute heuristic: ~130 WPM = ~2.2 words per second
            const wordCount = text.split(/\s+/).length;
            const estimatedDurationMs = Math.max(2000, (wordCount / 2.2) * 1000 + 1000);

            console.log(`[DIDAgentService] Speech started. Estimated duration: ${estimatedDurationMs}ms`);

            setTimeout(() => {
                console.log('[DIDAgentService] Speech finished.');
                this.callbacks.onVideoStateChange?.('idle');
                this.callbacks.onSpeechFinished?.();
            }, estimatedDurationMs);

        } catch (err) {
            console.error('[DIDAgentService] Speak failed:', err);
            this.callbacks.onVideoStateChange?.('idle');
            this.callbacks.onSpeechFinished?.(); // Trigger anyway so STT isn't blocked
        }
    }

    /** Disconnect the WebRTC session. */
    async disconnect(): Promise<void> {
        try {
            if (this.streamId && this.apiKey) {
                await fetch(`https://api.d-id.com/talks/streams/${this.streamId}`, {
                    method: 'DELETE',
                    headers: { 'Authorization': `Basic ${this.apiKey}` },
                    keepalive: true
                });
            }
        } catch (err) {
            console.error('[DIDAgentService] API disconnect failed:', err);
        }

        if (this.peerConnection) {
            this.peerConnection.close();
            this.peerConnection = null;
        }

        this.streamId = null;
        this.sessionId = null;
        this.srcObject = null;
        this.updateConnectionState('disconnected');
    }

    /** Reconnect (e.g. after network drop). */
    async reconnect(): Promise<void> {
        await this.disconnect();
        await this.connect();
    }

    /** Get the current srcObject for attaching to a video element. */
    getSrcObject(): MediaStream | null {
        return this.srcObject;
    }

    /** Check if the service has been initialised. */
    get isInitialised(): boolean {
        return this._isInitialised;
    }

    private updateConnectionState(state: ConnectionState) {
        this._connectionState = state;
        this.callbacks.onConnectionStateChange?.(state);
    }
}

// Export a singleton
export const didAgentService = new DIDAgentService();
