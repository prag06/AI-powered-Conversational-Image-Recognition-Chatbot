const socket = io();

const chatHistory = document.getElementById('chatHistory');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const imageInput = document.getElementById('imageInput');
const imagePreviewContainer = document.getElementById('imagePreviewContainer');
const imagePreview = document.getElementById('imagePreview');
const removeImageBtn = document.getElementById('removeImageBtn');
const loadingToast = document.getElementById('loadingToast');

// Camera Elements
const openCameraBtn = document.getElementById('openCameraBtn');
const cameraModal = document.getElementById('cameraModal');
const cameraVideo = document.getElementById('cameraVideo');
const cameraCanvas = document.getElementById('cameraCanvas');
const captureBtn = document.getElementById('captureBtn');
const closeCameraBtn = document.getElementById('closeCameraBtn');
let cameraStream = null;

let currentImageBase64 = null;
let currentImageMimeType = null;
let currentBotMessageElement = null;
let currentBotMessageContentElement = null;
let botRawText = "";
let loadingTimeout = null;

// Handle Image Upload
imageInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = (event) => {
            currentImageBase64 = event.target.result;
            currentImageMimeType = file.type;
            imagePreview.src = currentImageBase64;
            imagePreviewContainer.style.display = 'flex';
        };
        reader.readAsDataURL(file);
    }
});

// Remove Image Preview
removeImageBtn.addEventListener('click', () => {
    currentImageBase64 = null;
    currentImageMimeType = null;
    imagePreview.src = '';
    imagePreviewContainer.style.display = 'none';
    imageInput.value = '';
});

// Handle Camera Access
openCameraBtn.addEventListener('click', async () => {
    try {
        cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
        cameraVideo.srcObject = cameraStream;
        cameraModal.style.display = 'flex';
    } catch (err) {
        console.error("Error accessing the camera:", err);
        alert("Could not access the camera. Please ensure you are on localhost or HTTPS, and permissions are granted.");
    }
});

// Capture Photo
captureBtn.addEventListener('click', () => {
    if (!cameraStream) return;
    
    const context = cameraCanvas.getContext('2d');
    cameraCanvas.width = cameraVideo.videoWidth;
    cameraCanvas.height = cameraVideo.videoHeight;
    
    // Draw the current video frame to the canvas
    context.drawImage(cameraVideo, 0, 0, cameraCanvas.width, cameraCanvas.height);
    
    // Convert to Base64
    const dataUrl = cameraCanvas.toDataURL('image/jpeg', 0.9);
    
    // Set for chat preview and sending
    currentImageBase64 = dataUrl;
    currentImageMimeType = 'image/jpeg';
    imagePreview.src = currentImageBase64;
    imagePreviewContainer.style.display = 'flex';
    
    closeCamera();
});

// Close Camera
closeCameraBtn.addEventListener('click', closeCamera);

function closeCamera() {
    if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop());
        cameraStream = null;
    }
    cameraVideo.srcObject = null;
    cameraModal.style.display = 'none';
}

// Send Message
const sendMessage = () => {
    const text = messageInput.value.trim();
    if (!text && !currentImageBase64) return;

    // Display user message
    appendUserMessage(text, currentImageBase64);

    // Emit to server
    socket.emit('chat_message', {
        text: text,
        imageBase64: currentImageBase64,
        mimeType: currentImageMimeType
    });

    // Clear inputs
    messageInput.value = '';
    currentImageBase64 = null;
    currentImageMimeType = null;
    imagePreview.src = '';
    imagePreviewContainer.style.display = 'none';
    imageInput.value = '';

    // Scroll to bottom
    scrollToBottom();

    // Start loading timeout (show toast if it takes more than 2 seconds)
    clearTimeout(loadingTimeout);
    loadingToast.classList.remove('show');
    loadingTimeout = setTimeout(() => {
        loadingToast.classList.add('show');
    }, 2000);
};

sendBtn.addEventListener('click', sendMessage);
messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        sendMessage();
    }
});

// Helper functions for UI
function appendUserMessage(text, imageSrc) {
    const msgDiv = document.createElement('div');
    msgDiv.className = 'message user';
    
    let contentHtml = '';
    if (imageSrc) {
        contentHtml += `<img src="${imageSrc}" alt="Uploaded Image">`;
    }
    if (text) {
        contentHtml += `<p>${escapeHtml(text)}</p>`;
    }

    msgDiv.innerHTML = `
        <div class="avatar">U</div>
        <div class="message-content">${contentHtml}</div>
    `;
    
    chatHistory.appendChild(msgDiv);
}

function createBotMessagePlaceholder() {
    const msgDiv = document.createElement('div');
    msgDiv.className = 'message bot';
    
    msgDiv.innerHTML = `
        <div class="avatar">AI</div>
        <div class="message-content">
            <div class="typing-indicator" id="typingIndicator">
                <span></span><span></span><span></span>
            </div>
        </div>
    `;
    
    chatHistory.appendChild(msgDiv);
    currentBotMessageElement = msgDiv;
    currentBotMessageContentElement = msgDiv.querySelector('.message-content');
    scrollToBottom();
}

// Socket Event Listeners
socket.on('bot_response_start', () => {
    clearTimeout(loadingTimeout);
    loadingToast.classList.remove('show');
    botRawText = "";
    createBotMessagePlaceholder();
});

socket.on('bot_response_chunk', (chunk) => {
    // Remove typing indicator if it exists
    const indicator = currentBotMessageContentElement.querySelector('.typing-indicator');
    if (indicator) {
        indicator.remove();
    }
    
    botRawText += chunk;
    // For live streaming, we just append text without full markdown to avoid broken tags, 
    // but marked() can handle partials decently if we parse the whole thing each time.
    // To be efficient, we parse the accumulated text.
    currentBotMessageContentElement.innerHTML = marked.parse(botRawText);
    scrollToBottom();
});

socket.on('bot_response_end', (fullResponse) => {
    if (fullResponse) {
        currentBotMessageContentElement.innerHTML = marked.parse(fullResponse);
    }
    currentBotMessageElement = null;
    currentBotMessageContentElement = null;
    scrollToBottom();
});

socket.on('bot_error', (errorMsg) => {
    clearTimeout(loadingTimeout);
    loadingToast.classList.remove('show');
    
    if (!currentBotMessageElement) {
        createBotMessagePlaceholder();
        const indicator = currentBotMessageContentElement.querySelector('.typing-indicator');
        if (indicator) indicator.remove();
    }
    currentBotMessageContentElement.innerHTML = `<p style="color: #ef4444; font-weight: 600;">${errorMsg}</p>`;
    scrollToBottom();
});

function scrollToBottom() {
    chatHistory.scrollTop = chatHistory.scrollHeight;
}

function escapeHtml(unsafe) {
    return unsafe
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;")
         .replace(/'/g, "&#039;");
}
