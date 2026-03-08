import fetch from 'node-fetch';

const DID_API_KEY = 'a3VzaGFsc2hhcm00MzQ1QGdtYWlsLmNvbQ:JzZjCcCR1vRaJLT7uBZX2';

async function testTalksLifecycle() {
    try {
        console.log(`Testing POST /talks/streams...`);
        const streamRes = await fetch(`https://api.d-id.com/talks/streams`, {
            method: 'POST',
            headers: {
                'Authorization': `Basic ${DID_API_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                source_url: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=500&auto=format&fit=crop&q=60&ixlib=rb-4.0.3'
            }),
        });
        
        const stream = await streamRes.json();
        console.log('Stream Status:', streamRes.status);
        if (!streamRes.ok) return console.log(stream);

        console.log('Simulating Answer / SDP (we wont do real WebRTC but just send answer payload to mimic connected)...');
        // Actually, to get 400, we can just hit speak immediately.
        // The user got 400 when hitting speak. Let's send the exact payload 'didAgentService' uses.
        const talkRes = await fetch(`https://api.d-id.com/talks/streams/${stream.id}`, {
            method: 'POST',
            headers: {
                'Authorization': `Basic ${DID_API_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                script: { 
                    type: 'text', 
                    input: 'Hello',
                    provider: { type: 'microsoft', voice_id: 'en-US-JennyMultilingualV2Neural' }
                },
                session_id: stream.session_id,
                config: {
                    fluent: true,
                    pad_audio: 0
                }
            }),
        });
        
        console.log('Talk Status:', talkRes.status);
        console.log('Talk Body:', await talkRes.text());
        
        // Cleanup
        await fetch(`https://api.d-id.com/talks/streams/${stream.id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Basic ${DID_API_KEY}` }
        });
    } catch (e) {
        console.error(e);
    }
}

testTalksLifecycle();
