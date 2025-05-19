// frontend/js/esp32StripLight.js
// Manages BLE connection and commands for the ESP32 Strip Light controller

export class ESP32StripLightConnection {
    constructor() {
        this.deviceName = 'ESP32_Strip_Light_2'; // Hardcoded device name
        this.serviceUUID = 'a2b0d839-075d-4439-9775-f7f87437c7c3'; // Hardcoded service UUID
        this.commandCharacteristicUUID = 'c7d62238-f8c9-4b07-9cc7-7a52f9600d4d'; // Hardcoded command characteristic UUID

        this.device = null;
        this.server = null;
        this.commandCharacteristic = null;

        this.onConnectCallbacks = [];
        this.onDisconnectCallbacks = [];
        // No onDataCallbacks needed if it only sends commands and doesn't receive data/notifications

        this.textEncoder = new TextEncoder();
        this.isConnecting = false;
    }

    _triggerConnectCallbacks() {
        this.onConnectCallbacks.forEach(cb => cb(this.deviceName));
    }

    _triggerDisconnectCallbacks(reason) {
        this.onDisconnectCallbacks.forEach(cb => cb(this.deviceName, reason));
    }

    _onDisconnected(event) {
        const reason = event && event.reason ? event.reason : 'Connection lost';
        console.log(`Device ${this.deviceName} disconnected:`, reason);
        this.device = null;
        this.server = null;
        this.commandCharacteristic = null;
        this.isConnecting = false;
        this._triggerDisconnectCallbacks(reason);
    }

    async connect() {
        if (this.isConnecting || (this.device && this.device.gatt.connected)) {
            console.log(`Device ${this.deviceName} is already connecting or connected.`);
            return this.device && this.device.gatt.connected;
        }
        this.isConnecting = true;

        try {
            console.log(`Requesting Bluetooth Device: ${this.deviceName}`);
            this.device = await navigator.bluetooth.requestDevice({
                filters: [{ name: this.deviceName }],
                optionalServices: [this.serviceUUID]
            });

            if (!this.device) {
                console.log(`No device selected for ${this.deviceName}.`);
                this.isConnecting = false;
                this._triggerDisconnectCallbacks('No device selected');
                return false;
            }

            console.log(`Connecting to GATT Server on ${this.device.name}...`);
            this.device.addEventListener('gattserverdisconnected', this._onDisconnected.bind(this));
            this.server = await this.device.gatt.connect();

            console.log(`GATT Server connected for ${this.deviceName}. Getting service...`);
            const service = await this.server.getPrimaryService(this.serviceUUID);

            console.log(`Service obtained for ${this.deviceName}. Getting Command Characteristic ${this.commandCharacteristicUUID}...`);
            this.commandCharacteristic = await service.getCharacteristic(this.commandCharacteristicUUID);
            console.log(`Command Characteristic obtained for ${this.deviceName}`);

            console.log(`Device ${this.deviceName} connected and characteristic ready.`);
            this.isConnecting = false;
            this._triggerConnectCallbacks();
            return true;

        } catch (error) {
            console.error(`Error connecting to ${this.deviceName}:`, error);
            if (this.device) {
                this.device.removeEventListener('gattserverdisconnected', this._onDisconnected.bind(this));
                if (this.device.gatt && this.device.gatt.connected) {
                    this.device.gatt.disconnect();
                } else {
                    this._onDisconnected({ reason: error.message || 'Connection failed during setup' });
                }
            } else {
                 this._onDisconnected({ reason: error.message || 'Connection failed before device object assignment' });
            }
            this.isConnecting = false;
            return false;
        }
    }

    async sendCommand(command) {
        if (!this.commandCharacteristic || !this.device || !this.device.gatt.connected) {
            console.error(`Cannot send command to ${this.deviceName}. Not connected or command characteristic not available.`);
            return false;
        }
        try {
            const commandArrayBuffer = this.textEncoder.encode(command);
            await this.commandCharacteristic.writeValueWithoutResponse(commandArrayBuffer);
            // console.log(`Command "${command}" sent to ${this.deviceName}`);
            return true;
        } catch (error) {
            console.error(`Error sending command "${command}" to ${this.deviceName}:`, error);
            return false;
        }
    }

    async disconnect() {
        if (this.device && this.device.gatt.connected) {
            console.log(`Disconnecting from ${this.deviceName}...`);
            this.device.removeEventListener('gattserverdisconnected', this._onDisconnected.bind(this));
            this.device.gatt.disconnect(); 
        } else {
            console.log(`Device ${this.deviceName} is not connected or already disconnected.`);
            this._onDisconnected({ reason: 'Manual disconnect on non-connected device' });
        }
    }

    on(event, callback) {
        if (event === 'connect') this.onConnectCallbacks.push(callback);
        else if (event === 'disconnect') this.onDisconnectCallbacks.push(callback);
        else console.warn(`Unsupported event type for ${this.deviceName}: ${event}`);
    }

    isConnected() {
        return this.device && this.device.gatt && this.device.gatt.connected;
    }
}
