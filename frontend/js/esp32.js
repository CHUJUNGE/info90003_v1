// D:\info90003_v1\frontend\js\esp32.js
// New content for Web Bluetooth API
export class ESP32BLEConnection {
    constructor() {
        this.device = null;
        this.server = null;
        this.commandCharacteristic = null;
        this.mpuCharacteristic = null;

        this.onConnectCallbacks = [];
        this.onDisconnectCallbacks = [];
        this.onDataCallbacks = []; // For MPU data or other notifications

        // These UUIDs must match your ESP32 firmware
        this.serviceUUID = '4fafc201-1fb5-459e-8fcc-c5c9c331914b';
        this.commandCharacteristicUUID = 'beb5483e-36e1-4688-b7f5-ea07361b26a8';
        this.mpuCharacteristicUUID = '1c95d5e6-2080-4808-a504-18763a9866ea';

        this.textEncoder = new TextEncoder(); // To encode string commands to ArrayBuffer
        this.textDecoder = new TextDecoder(); // To decode ArrayBuffer data to string
    }

    async connect() {
        try {
            console.log('Requesting Bluetooth Device (ESP32_Scene_Control)...');
            this.device = await navigator.bluetooth.requestDevice({
                filters: [{ name: 'ESP32_Scene_Control' }],
                optionalServices: [this.serviceUUID]
            });

            if (!this.device) {
                console.log('No device selected.');
                this._triggerDisconnectCallbacks('No device selected');
                return false;
            }

            console.log(`Connecting to GATT Server on ${this.device.name}...`);
            this.device.addEventListener('gattserverdisconnected', this._onDisconnected.bind(this));
            this.server = await this.device.gatt.connect();

            console.log('Getting Service UUID:', this.serviceUUID);
            const service = await this.server.getPrimaryService(this.serviceUUID);

            console.log('Getting Command Characteristic UUID:', this.commandCharacteristicUUID);
            this.commandCharacteristic = await service.getCharacteristic(this.commandCharacteristicUUID);
            console.log('Command Characteristic found.');

            console.log('Getting MPU Characteristic UUID:', this.mpuCharacteristicUUID);
            this.mpuCharacteristic = await service.getCharacteristic(this.mpuCharacteristicUUID);
            console.log('MPU Characteristic found.');

            // Setup notifications for MPU data
            if (this.mpuCharacteristic && this.mpuCharacteristic.properties.notify) {
                await this.mpuCharacteristic.startNotifications();
                this.mpuCharacteristic.addEventListener('characteristicvaluechanged', this._handleMPUData.bind(this));
                console.log('Notifications started for MPU data.');
            } else {
                console.warn('MPU characteristic does not support notifications or not found.');
            }

            console.log('ESP32 BLE Connected successfully!');
            this._triggerConnectCallbacks();
            return true;

        } catch (error) {
            console.error('BLE Connection Error:', error);
            if (this.device && this.device.gatt && this.device.gatt.connected) {
                this.device.gatt.disconnect();
            }
            // The 'gattserverdisconnected' event should trigger _onDisconnected
            // but if not, we ensure callbacks are called.
            if (!this.onDisconnectCallbacks.length === 0 || this.server ) { 
                 // Avoid double-triggering if already handled by event
            } else {
                 this._triggerDisconnectCallbacks(error.message || 'Connection failed');
            }
            this.server = null; // Ensure server is null on error
            return false;
        }
    }

    _onDisconnected(event) {
        const deviceName = this.device ? this.device.name : 'Unknown device';
        console.log(`Device ${deviceName} disconnected.`);
        // console.log('Disconnect event:', event); // For more details
        
        this.device = null;
        this.server = null;
        this.commandCharacteristic = null;
        this.mpuCharacteristic = null;
        this._triggerDisconnectCallbacks(event.reason || 'Device disconnected');
    }

    async disconnect() {
        if (!this.device || !this.device.gatt || !this.device.gatt.connected) {
            console.log('Device not connected or already disconnected.');
            // Ensure callbacks are fired if state is inconsistent
            if (this.server) this._triggerDisconnectCallbacks('Already disconnected');
            this.server = null;
            return;
        }
        try {
            console.log('Disconnecting from Bluetooth Device...');
            if (this.mpuCharacteristic && this.mpuCharacteristic.properties.notify) {
                try {
                    await this.mpuCharacteristic.stopNotifications();
                    this.mpuCharacteristic.removeEventListener('characteristicvaluechanged', this._handleMPUData.bind(this));
                    console.log('Stopped MPU notifications.');
                } catch (notifyError) {
                    console.warn('Could not stop MPU notifications cleanly:', notifyError);
                }
            }
            this.device.gatt.disconnect();
            // The _onDisconnected event listener handles resetting state and callbacks.
        } catch (error) {
            console.error('Error disconnecting:', error);
            // Force trigger disconnect if gatt.disconnect fails to fire event properly
            this._onDisconnected({ target: this.device, reason: 'Forced disconnect due to error' });
        }
    }

    _handleMPUData(event) {
        const value = event.target.value; // This is a DataView
        const mpuDataString = this.textDecoder.decode(value);
        // console.log('Received MPU Data (raw string):', mpuDataString);
        
        try {
            // Attempt to parse as JSON, as ESP32 might send structured data
            const jsonData = JSON.parse(mpuDataString);
            // console.log('Received MPU Data (JSON):', jsonData);
            this.onDataCallbacks.forEach(callback => callback({ type: 'mpu', payload: jsonData }));
        } catch (e) {
            // If not JSON, or if JSON parsing fails, pass the raw string
            // This could be simple comma-separated values or a plain status message
            // console.log('MPU Data is not JSON, passing as string.');
            this.onDataCallbacks.forEach(callback => callback({ type: 'mpu_string', payload: mpuDataString }));
        }
    }

    async sendCommand(commandString) {
        if (!this.commandCharacteristic) {
            console.error('Command characteristic not available. Cannot send command.');
            return false;
        }
        if (!this.isConnected()) {
            console.error('Not connected to ESP32. Cannot send command.');
            return false;
        }

        try {
            const data = this.textEncoder.encode(commandString); // Encode string to Uint8Array
            await this.commandCharacteristic.writeValueWithResponse(data);
            console.log(`Sent command: ${commandString}`);
            return true;
        } catch (error) {
            console.error(`Failed to send command '${commandString}':`, error);
            return false;
        }
    }

    // --- LED Control Commands (Example) ---
    // Commands based on your Arduino sketch's MyCommandCharacteristicCallbacks::onWrite
    async setLedMode(mode) {
        let command;
        switch(mode) {
            case 0: command = "L0"; break; // OFF
            case 1: command = "L1"; break; // RED (Constant)
            case 2: command = "L2"; break; // BLUE (Constant)
            case 3: command = "L3"; break; // GREEN (Constant)
            case 4: command = "L4"; break; // RED Animation
            case 5: command = "L5"; break; // BLUE Animation
            default:
                console.warn(`Unknown LED mode: ${mode}. Sending L0 (OFF).`);
                command = "L0";
        }
        return this.sendCommand(command);
    }

    // --- Motor Control (Example) ---
    async vibrateMotor() {
        // Assuming your ESP32 handles 'M1' or similar for motor
        return this.sendCommand("M1"); 
    }
    
    // --- Callbacks ---
    onConnect(callback) {
        this.onConnectCallbacks.push(callback);
        return this;
    }

    onDisconnect(callback) {
        this.onDisconnectCallbacks.push(callback);
        return this;
    }

    onData(callback) { // For MPU data and other notifications
        this.onDataCallbacks.push(callback);
        return this;
    }

    _triggerConnectCallbacks() {
        this.onConnectCallbacks.forEach(cb => cb());
    }

    _triggerDisconnectCallbacks(reason) {
        this.onDisconnectCallbacks.forEach(cb => cb(reason));
    }

    isConnected() {
        return this.device && this.device.gatt && this.device.gatt.connected;
    }
}

// Expose the class to the global scope if needed, e.g., for use in index.html
if (typeof window !== 'undefined') {
    window.ESP32BLEConnection = ESP32BLEConnection;
}