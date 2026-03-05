const testSummary = async () => {
    const data = {
        technical: { messages: [{ sender: 'ai', text: 'What is a linked list?' }, { sender: 'user', text: 'A linear data structure...' }] },
        project: { messages: [{ sender: 'ai', text: 'Tell me about your project.' }, { sender: 'user', text: 'I built a web app...' }] },
        hr: { messages: [{ sender: 'ai', text: 'What are your strengths?' }, { sender: 'user', text: 'I am a fast learner...' }] },
        resume: { skills: ['JavaScript', 'React'], projects: ['E-commerce site'] },
        emotions: []
    };

    try {
        console.log('Testing summary API at http://localhost:3001/api/summary...');
        const response = await fetch('http://localhost:3001/api/summary', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });

        if (!response.ok) {
            const err = await response.json();
            throw new Error(`API error: ${response.status} - ${JSON.stringify(err)}`);
        }

        const result = await response.json();
        console.log('Summary generated successfully:');
        console.log(result.summary.substring(0, 1000) + '...');
    } catch (error) {
        console.error('Test failed:', error.message);
    }
}

testSummary();
