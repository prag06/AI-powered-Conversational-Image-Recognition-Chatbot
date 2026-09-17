require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Initialize Gemini API
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function checkAvailableModels() {
    try {
        console.log("Checking API key permissions and available models...");
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${process.env.GEMINI_API_KEY}`);
        const data = await response.json();
        
        if (data.error) {
            console.error("\n❌ API KEY ERROR:", data.error.message);
            console.error("Please verify your API key is correct and has the Generative Language API enabled in Google Cloud Console.\n");
        } else if (data.models) {
            const modelNames = data.models.map(m => m.name.replace('models/', ''));
            console.log("\n✅ API KEY IS VALID!");
            console.log("Available Models:", modelNames.join(", "));
            
            if (!modelNames.includes("gemini-1.5-flash")) {
                console.log("\n⚠️ WARNING: Your API key does NOT have access to 'gemini-1.5-flash'!");
            }
        }
    } catch (e) {
        console.error("Failed to check models:", e.message);
    }
}
checkAvailableModels();

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

const chatHistories = new Map();

io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);
    chatHistories.set(socket.id, []);

    socket.on('chat_message', async (data) => {
        const { text, imageBase64, mimeType } = data;
        
        try {
            const promptParts = [];
            
            // Safely extract base64 data regardless of mime type
            if (imageBase64) {
                const base64Data = imageBase64.includes(',') ? imageBase64.split(',')[1] : imageBase64;
                promptParts.push({
                    inlineData: { data: base64Data, mimeType: mimeType || "image/jpeg" }
                });
            }
            
            if (text) {
                promptParts.push({ text: text });
            }

            // Retrieve history for this socket
            const history = chatHistories.get(socket.id) || [];
            
            let result;
            
            try {
                // Try the primary lightning-fast model
                const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
                const chat = model.startChat({ history: history });
                result = await chat.sendMessageStream(promptParts);
            } catch (apiError) {
                // If the primary model is overloaded (503), automatically fall back to another highly capable model
                if (apiError.message && apiError.message.includes("503")) {
                    console.log("⚠️ 503 High Demand Error! Automatically falling back to gemini-2.0-flash...");
                    const fallbackModel = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
                    const fallbackChat = fallbackModel.startChat({ history: history });
                    result = await fallbackChat.sendMessageStream(promptParts);
                } else {
                    throw apiError; // Throw other errors (like invalid keys) normally
                }
            }
            
            let fullResponse = "";
            socket.emit('bot_response_start');

            for await (const chunk of result.stream) {
                const chunkText = chunk.text();
                fullResponse += chunkText;
                socket.emit('bot_response_chunk', chunkText);
            }

            socket.emit('bot_response_end', fullResponse);
            
            // Update history to remember this interaction!
            history.push({ role: 'user', parts: promptParts });
            history.push({ role: 'model', parts: [{ text: fullResponse }] });
            chatHistories.set(socket.id, history);

        } catch (error) {
            console.error('Error generating content:', error);
            socket.emit('bot_error', `API Error: ${error.message}`);
        }
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        chatHistories.delete(socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
