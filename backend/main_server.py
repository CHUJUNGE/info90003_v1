# backend/main_server.py
import os
from flask import Flask, send_from_directory, request
from flask_socketio import SocketIO, emit
import threading
import time

# Adjust the import path if rfid_reader and epc_mappings are in the same directory (backend)
# For example, if main_server.py is in 'backend' and rfid_reader.py is also in 'backend'
from rfid_reader import RFIDReader
from epc_mappings import get_name_for_epc


app = Flask(__name__, static_folder='../frontend/assets')
# Use a secret key for session management, although not strictly necessary for this specific SocketIO setup
app.config['SECRET_KEY'] = 'your_very_secret_key_here!'
socketio = SocketIO(app, cors_allowed_origins="*") # Allow all origins for simplicity in development

# --- RFID Scanner Setup ---
# Use the COM port defined in rfid_reader.py or specify one here
# Ensure this COM port is correct for your RFID reader
rfid_reader_instance = RFIDReader(port="COM4")
scanning_thread = None
stop_scanning_event = threading.Event()
is_scanning_active = False # Global flag to track if scanning is active

# --- Frontend Serving ---
@app.route('/')
def index():
    # Serves index.html from the frontend directory
    return send_from_directory('../frontend', 'index.html')

@app.route('/<path:path>')
def serve_static_files(path):
    # Serves other static files (css, js, assets) from the frontend directory
    if path.startswith('assets/'):
        return send_from_directory('../frontend/assets', path.replace('assets/', '', 1))
    # Serve other files like .js, .css from ../frontend
    if path.endswith(('.js', '.css', '.json', '.ico', '.png', '.jpg', '.mp4', '.webm', '.ogg')): # Add other file types if needed
         return send_from_directory('../frontend', path)
    # Fallback or specific handling for other paths if necessary
    return send_from_directory('../frontend', path) # Default for any other path


# --- RFID Scanning Logic ---
def rfid_scan_loop():
    global is_scanning_active
    print("RFID scan loop thread invoked.") # Changed log slightly
    if not is_scanning_active:
        print("RFID scan loop invoked, but is_scanning_active is False. Exiting loop immediately.")
        return # Exit if not explicitly activated
    print("RFID scan loop started (is_scanning_active is True).")
    
    if not rfid_reader_instance.connect(): # Connect once at the start of the loop
        print("RFID Reader: Failed to connect in scan loop.")
        socketio.emit('rfid_error', {'message': 'Failed to connect to RFID reader.'})
        is_scanning_active = False
        return

    try:
        while not stop_scanning_event.is_set():
            # Check connection status before attempting scan; try to reconnect if necessary
            if not rfid_reader_instance.is_connected:
                print("RFID Reader: Was disconnected. Attempting to reconnect...")
                if not rfid_reader_instance.connect():
                    print("RFID Reader: Reconnect failed. Will try again later.")
                    socketio.emit('rfid_error', {'message': 'RFID reader disconnected. Attempting to reconnect...'})
                    socketio.sleep(2) # Wait before retrying connection
                    continue # Skip this iteration and try to reconnect in the next one

            # Use the new method that assumes connection is managed externally
            response = rfid_reader_instance._perform_scan_attempt() 

            if response.get("status") == "success":
                epc = response.get("epc_hex")
                item_name = get_name_for_epc(epc)
                print(f"RFID Scan: Tag found - EPC: {epc}, Name: {item_name if item_name else 'Unknown'}")
                socketio.emit('rfid_data', {
                    'status': 'success',
                    'epc': epc,
                    'name': item_name if item_name else 'Unknown',
                    'rssi': response.get('rssi_dbm'),
                    'pc': response.get('pc_hex')
                })
                # Example: if you want to stop after finding one specific tag.
                # if item_name == "cup":
                #     stop_scanning_event.set() # Signal to stop
                #     break
            elif response.get("status") == "no_tag_found":
                # print("RFID Scan: No tag found in this attempt.") # Can be spammy
                socketio.emit('rfid_data', {'status': 'no_tag_found', 'message': 'No tag found'})
            elif response.get("status") == "error":
                print(f"RFID Scan Error: {response.get('message')}")
                socketio.emit('rfid_error', {'message': response.get('message')})
                # If certain errors occur (e.g., serial port gone), might try to reconnect or stop.
                if "Serial port not connected" in response.get('message', "") or \
                   "Serial communication error" in response.get('message', ""):
                    print("RFID Reader: Critical serial error. Attempting to handle...")
                    rfid_reader_instance.disconnect() # Ensure it's marked as disconnected
                    # The loop will attempt to reconnect at the start of the next iteration.
            
            socketio.sleep(0.1) # Polling interval. Adjusted for faster attempts.
                                # Be mindful of system load and reader capabilities.
    
    except Exception as e:
        print(f"Exception in RFID scan loop: {e}")
        socketio.emit('rfid_error', {'message': f'Critical error in scan loop: {str(e)}'})
    finally:
        print("RFID scan loop cleaning up.")
        if rfid_reader_instance.is_connected:
            rfid_reader_instance.disconnect() # Disconnect when loop ends
        is_scanning_active = False
        print("RFID scan loop finished.")

# --- Socket.IO Event Handlers ---
@socketio.on('connect')
def handle_connect():
    print(f"Client connected: {request.sid}")
    # Optionally, send current scanning state or other initial info
    # emit('scan_status', {'active': is_scanning_active})

@socketio.on('disconnect')
def handle_disconnect():
    print(f"Client disconnected: {request.sid}")
    # If this is the last client or specific conditions met, you might stop scanning.
    # For now, scanning stops only on explicit 'stop_rfid_scan' or server shutdown.

@socketio.on('start_rfid_scan')
def handle_start_rfid_scan():
    global scanning_thread, is_scanning_active
    client_sid = request.sid
    print(f"Received start_rfid_scan request from {client_sid}.")

    if is_scanning_active:
        print("Scan already active.")
        emit('rfid_status', {'status': 'already_scanning', 'message': 'RFID scanning is already active.'})
        return

    is_scanning_active = True
    stop_scanning_event.clear()
    
    scanning_thread = threading.Thread(target=rfid_scan_loop)
    scanning_thread.daemon = True 
    scanning_thread.start()
    print("RFID scanning thread started.")
    emit('rfid_status', {'status': 'scanning_started', 'message': 'RFID scanning initiated.'})

@socketio.on('stop_rfid_scan')
def handle_stop_rfid_scan():
    global is_scanning_active # ensure we modify the global
    client_sid = request.sid
    print(f"Received stop_rfid_scan request from {client_sid}.")
    
    if not is_scanning_active and (not scanning_thread or not scanning_thread.is_alive()):
        print("Scan not active or thread not running.")
        emit('rfid_status', {'status': 'already_stopped', 'message': 'RFID scanning is not active.'})
        return

    stop_scanning_event.set()
    # The is_scanning_active flag will be set to False by the rfid_scan_loop's finally block.
    # We can emit the status update here optimistically.
    print("RFID scanning stop signal sent. Loop will terminate and clean up.")
    emit('rfid_status', {'status': 'stopping', 'message': 'RFID scanning is stopping.'})
    # Note: is_scanning_active is fully false once thread confirms exit.


if __name__ == '__main__':
    print("Starting Flask-SocketIO server on http://0.0.0.0:5000")
    socketio.run(app, host='0.0.0.0', port=5000, debug=True, allow_unsafe_werkzeug=True, use_reloader=False)
    # use_reloader=False is important for threads to behave predictably during dev

