from flask import Flask, jsonify, send_from_directory
import os
from .rfid_reader import RFIDReader # Assuming rfid_reader.py is in the same directory
from .epc_mappings import get_name_for_epc # Assuming epc_mappings.py is in the same directory

# Определяем путь к каталогу frontend относительно текущего файла (app.py)
# app.py находится в backend/, frontend/ находится на одном уровне с backend/
# поэтому нам нужно подняться на один уровень из backend/ и затем войти в frontend/
FRONTEND_FOLDER = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'frontend')

app = Flask(__name__, static_folder=FRONTEND_FOLDER) # <-- 修改这里，但主要通过路由提供

# Initialize RFIDReader once if you want to keep the connection open (advanced)
# For simplicity, we'll create it per request for now.
# rfid_scanner = RFIDReader() 
# rfid_scanner.connect() # You'd need to handle connect/disconnect carefully

@app.route('/api/scan_tag', methods=['GET'])
def scan_tag_api():
    reader = None
    try:
        reader = RFIDReader() # Create an instance for each scan
        # Note: connect() and disconnect() are called within scan_single_tag()
        scan_result = reader.scan_single_tag()

        response_data = {
            'status': scan_result.get('status'),
            'message': scan_result.get('message', '') # Include message for errors or no_tag
        }

        if scan_result.get('status') == 'success':
            epc = scan_result.get('epc_hex')
            human_name = get_name_for_epc(epc)
            response_data.update({
                'epc': epc,
                'rssi_dbm': scan_result.get('rssi_dbm'),
                'pc_hex': scan_result.get('pc_hex'),
                'item_name': human_name if human_name else 'Unknown Item'
            })
        elif scan_result.get('status') == 'no_tag_found':
            response_data['message'] = 'No RFID tag found in the reader\'s field.'
        elif scan_result.get('status') == 'error':
            # Message is already set from scan_result
            pass
        
        return jsonify(response_data)

    except Exception as e:
        # Log the exception e for server-side debugging
        print(f"Error in scan_tag_api: {str(e)}")
        return jsonify({'status': 'error', 'message': f'An internal server error occurred: {str(e)}'}), 500
    finally:
        # Ensure the reader is disconnected if it was connected outside scan_single_tag
        # However, our current RFIDReader.scan_single_tag handles its own connect/disconnect.
        pass

# --- 新增前端路由 ---
@app.route('/')
def serve_index():
    # Отправляем index.html из каталога FRONTEND_FOLDER
    return send_from_directory(FRONTEND_FOLDER, 'index.html')

@app.route('/<path:filename>')
def serve_static(filename):
    # Отправляем любой запрошенный файл из FRONTEND_FOLDER
    # Это будет обрабатывать style.css, js/esp32.js и т.д.
    return send_from_directory(FRONTEND_FOLDER, filename)
# --- 结束新增前端路由 ---

if __name__ == '__main__':
    # Make sure to run from the 'd:\info90003_v1' directory using:
    # python -m backend.app
    # This helps with relative imports if rfid_reader and epc_mappings are treated as part of a package.
    # Alternatively, if running backend/app.py directly, ensure PYTHONPATH is set or imports are adjusted.
    print("Starting Flask server...")
    print("RFID Scan API available at http://localhost:5000/api/scan_tag")
    app.run(host='0.0.0.0', port=5000, debug=True) # debug=True is for development
