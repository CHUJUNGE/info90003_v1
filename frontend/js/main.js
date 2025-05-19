// frontend/js/main.js
import { ESP32BLEConnection } from './esp32.js';
import { ESP32StripLightConnection } from './esp32StripLight.js';

document.addEventListener('DOMContentLoaded', () => {
    // ESP32 Instances
    const esp32Main = new ESP32BLEConnection(); // Main ESP32 (Scene Control)
    const esp32StripLight = new ESP32StripLightConnection(); // Strip Light ESP32

    // --- Get UI Elements ---
    // Main ESP32
    const connectMainBtn = document.getElementById('connect-main-esp32-btn');
    const mainStatusModal = document.getElementById('main-esp32-modal-status');
    const mainStatusIndicator = document.getElementById('main-esp32-status-text');

    // Strip Light ESP32
    const connectStripBtn = document.getElementById('connect-strip-light-esp32-btn');
    const stripStatusModal = document.getElementById('strip-light-esp32-modal-status');
    const stripStatusIndicator = document.getElementById('strip-light-esp32-status-text');
    
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


    // --- Strip Light ESP32 (ESP32_Strip_Light_2) Event Handlers & Logic ---
    if (connectStripBtn) {
        connectStripBtn.addEventListener('click', async () => {
            if (!esp32StripLight.isConnected()) {
                updateConnectionStatusUI('Strip Light ESP32', 'Connecting...', stripStatusModal, stripStatusIndicator);
                const success = await esp32StripLight.connect();
                if (success) {
                    updateConnectionStatusUI('Strip Light ESP32', 'Connected', stripStatusModal, stripStatusIndicator);
                } else {
                    updateConnectionStatusUI('Strip Light ESP32', 'Failed to Connect', stripStatusModal, stripStatusIndicator);
                }
            } else {
                esp32StripLight.disconnect();
            }
        });
    }

    esp32StripLight.on('connect', (deviceName) => {
        updateConnectionStatusUI('Strip Light ESP32', 'Connected', stripStatusModal, stripStatusIndicator);
        if (connectStripBtn) connectStripBtn.textContent = 'Disconnect Strip Light ESP32';
    });

    esp32StripLight.on('disconnect', (deviceName, reason) => {
        updateConnectionStatusUI('Strip Light ESP32', `Disconnected (${reason || 'user action'})`, stripStatusModal, stripStatusIndicator);
        if (connectStripBtn) connectStripBtn.textContent = 'Connect Strip Light ESP32';
    });

    // NO DEDICATED STRIP LIGHT BUTTONS - Commands will be sent from other parts of your application logic
    // e.g., during specific scene transitions or events:
    // if (esp32StripLight.isConnected()) {
    //     esp32StripLight.sendCommand('blue');
    // }


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

    // Initialize status on page load
    updateConnectionStatusUI('Main ESP32', 'Disconnected', mainStatusModal, mainStatusIndicator);
    updateConnectionStatusUI('Strip Light ESP32', 'Disconnected', stripStatusModal, stripStatusIndicator);
    
    // Make ESP32 instances available globally FOR NOW - for easier integration with existing inline script.
    // Consider refactoring inline script to import these or pass them as parameters.
    window.esp32Main = esp32Main;
    window.esp32StripLight = esp32StripLight;

    console.log("Main Bluetooth script loaded and initialized. LED strip controls are NOT managed by dedicated buttons.");

    // --- TODO: Integrate your existing globe.js, stage transitions, and other logic below ---
    // Remember to replace 'esp32Connection' with 'esp32Main' or 'esp32StripLight' where appropriate.
});
