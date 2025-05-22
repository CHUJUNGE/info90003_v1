// frontend/js/main.js
import { ESP32BLEConnection } from './esp32.js';

document.addEventListener('DOMContentLoaded', () => {
    // ESP32 Instance
    const esp32Main = new ESP32BLEConnection(); // Main ESP32 (Scene Control)

    // --- Get UI Elements ---
    // Main ESP32
    const connectMainBtn = document.getElementById('connect-main-esp32-btn');
    const mainStatusModal = document.getElementById('main-esp32-modal-status');
    const mainStatusIndicator = document.getElementById('main-esp32-status-text');
    
    // Modal close buttons
    const closeModalBtn = document.getElementById('close-modal-btn');


    // --- Helper Functions to Update UI ---
    function updateConnectionStatusUI(deviceType, statusText, modalElement, indicatorElement) {
        const message = `${deviceType}: ${statusText}`;
        if (modalElement) modalElement.textContent = message;
        if (indicatorElement) indicatorElement.textContent = statusText;
        
        if (indicatorElement) {
            if (statusText.toLowerCase().includes('connected')) {
                indicatorElement.style.color = 'lime';
            } else if (statusText.toLowerCase().includes('connecting')) {
                indicatorElement.style.color = 'yellow';
            } else {
                indicatorElement.style.color = 'red';
            }
        }
    }

    // --- Main ESP32 (ESP32_Scene_Control) Event Handlers & Logic ---
    if (connectMainBtn) {
        connectMainBtn.addEventListener('click', async () => {
            if (!esp32Main.isConnected()) {
                updateConnectionStatusUI('Main ESP32', 'Connecting...', mainStatusModal, mainStatusIndicator);
                const success = await esp32Main.connect();
                if (success) {
                    updateConnectionStatusUI('Main ESP32', 'Connected', mainStatusModal, mainStatusIndicator);
                } else {
                    updateConnectionStatusUI('Main ESP32', 'Failed to Connect', mainStatusModal, mainStatusIndicator);
                }
            } else {
                esp32Main.disconnect();
            }
        });
    }

    esp32Main.onConnect(() => { // Changed from esp32Main.on('connect', ...)
        updateConnectionStatusUI('Main ESP32', 'Connected', mainStatusModal, mainStatusIndicator);
        if (connectMainBtn) connectMainBtn.textContent = 'Disconnect Main ESP32';
        // 连接成功后不自动关闭模态框，让用户手动关闭
        console.log('Main ESP32连接成功，模态框保持打开状态，需要手动关闭');
    });

    esp32Main.onDisconnect((reason) => { // Changed from esp32Main.on('disconnect', ...)
        updateConnectionStatusUI('Main ESP32', `Disconnected (${reason || 'user action'})`, mainStatusModal, mainStatusIndicator);
        if (connectMainBtn) connectMainBtn.textContent = 'Connect Main ESP32';
    });

    // Example for data handling, if you use it:
    // esp32Main.onData((dataObject) => { 
    //     // dataObject will be { type: 'mpu', payload: jsonData } or { type: 'mpu_string', payload: mpuDataString }
    //     console.log(`Data from Main ESP32 (${dataObject.type}):`, dataObject.payload);
    //     // Update UI or trigger actions based on dataObject.type and dataObject.payload
    // });


    // Strip Light ESP32 功能已移除，因为 LED 灯带现在通电后自动循环显示效果


    // --- Modal Handling ---
    const modal = document.getElementById('esp32-connect-modal');
    if (closeModalBtn && modal) {
        closeModalBtn.addEventListener('click', () => {
            modal.style.display = 'none';
        });
    }
    window.addEventListener('click', (event) => {
        if (event.target === modal && modal) {
            modal.style.display = 'none';
        }
    });
    
    // 确保模态框在页面加载时显示
    if (modal) {
        modal.style.display = 'block';
        console.log('ESP32连接模态框已显示，连接成功后不会自动关闭，需要手动关闭');
    }
    
    // 添加空格键切换模态框显示/隐藏的功能
    document.addEventListener('keydown', (event) => {
        if (event.code === 'Space' && modal) {
            if (modal.style.display === 'none') {
                modal.style.display = 'block';
            } else {
                modal.style.display = 'none';
            }
            // 防止空格键滚动页面
            event.preventDefault();
        }
    });

    // Initialize status on page load
    updateConnectionStatusUI('Main ESP32', 'Disconnected', mainStatusModal, mainStatusIndicator);
    
    // Make ESP32 instance available globally FOR NOW - for easier integration with existing inline script.
    // Consider refactoring inline script to import these or pass them as parameters.
    window.esp32Main = esp32Main;

    console.log("Main Bluetooth script loaded and initialized.");

    // --- TODO: Integrate your existing globe.js, stage transitions, and other logic below ---
    // Remember to replace 'esp32Connection' with 'esp32Main' or 'esp32StripLight' where appropriate.
});
