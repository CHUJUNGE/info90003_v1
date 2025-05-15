import serial
import time
from epc_mappings import get_name_for_epc # epc_mappings is in the same directory

# Module-level helper function for checksum calculation
def calculate_checksum(data_list):
    """Calculates the checksum for the given list of byte values."""
    return sum(data_list) & 0xFF

class RFIDReader:
    DEFAULT_SERIAL_PORT = "COM4"
    DEFAULT_BAUD_RATE = 115200

    def __init__(self, port=DEFAULT_SERIAL_PORT, baudrate=DEFAULT_BAUD_RATE, timeout=1):
        self.port = port
        self.baudrate = baudrate
        self.timeout = timeout # Default timeout for serial read operations
        self.serial_conn = None
        self.is_connected = False

    def connect(self):
        if self.is_connected and self.serial_conn and self.serial_conn.is_open:
            # print(f"RFID Reader: Already connected to {self.port}.")
            return True
        try:
            # Ensure previous connection is closed if object is reused
            if self.serial_conn and self.serial_conn.is_open:
                self.serial_conn.close()
            
            self.serial_conn = serial.Serial(self.port, self.baudrate, timeout=self.timeout)
            self.is_connected = True
            # print(f"RFID Reader: Successfully connected to {self.port} at {self.baudrate} baud.")
            return True
        except serial.SerialException as e:
            print(f"RFID Reader: Serial connection error on {self.port}: {e}")
            self.is_connected = False
            self.serial_conn = None # Ensure serial_conn is None on failure
            return False

    def disconnect(self):
        if self.serial_conn and self.serial_conn.is_open:
            self.serial_conn.close()
        self.is_connected = False
        # print("RFID Reader: Serial port closed.")
        # self.serial_conn = None # Option to fully reset, or leave for potential re-open

    def _build_command_frame(self, command_type, command_code, params=None):
        if params is None:
            params = []
        
        payload_len_msb = (len(params) >> 8) & 0xFF
        payload_len_lsb = len(params) & 0xFF
        
        # Data for checksum: Type, Cmd, PL_MSB, PL_LSB, Params (if any)
        frame_parts_for_checksum = [command_type, command_code, payload_len_msb, payload_len_lsb] + params
        checksum = calculate_checksum(frame_parts_for_checksum)
        
        full_frame = [0xBB] + frame_parts_for_checksum + [checksum, 0x7E]
        return bytes(full_frame)

    def _get_single_inventory_command(self):
        # Command: BB 00 22 00 00 22 7E
        return self._build_command_frame(command_type=0x00, command_code=0x22, params=[])

    def _parse_response_data(self, response_bytes):
        if not response_bytes:
            return {"status": "error", "message": "No response from reader (timeout likely)."}
        
        # print(f"RFID Reader DEBUG: Raw response_bytes (len={len(response_bytes)}): {response_bytes.hex().upper() if response_bytes else 'None'}")

        if len(response_bytes) < 8: # Minimum length for any valid frame
            return {"status": "error", "message": f"Response too short ({len(response_bytes)} bytes): {response_bytes.hex().upper()}"}

        if response_bytes[0] != 0xBB or response_bytes[-1] != 0x7E:
            return {"status": "error", "message": f"Invalid frame start/end bytes: {response_bytes.hex().upper()}"}
        
        data_for_checksum_calc = list(response_bytes[1:-2])
        received_checksum_byte = response_bytes[-2]
        calculated_response_checksum = calculate_checksum(data_for_checksum_calc)

        if received_checksum_byte != calculated_response_checksum:
            return {"status": "error", "message": f"Response checksum mismatch. Expected {calculated_response_checksum:02X}, Got {received_checksum_byte:02X}. Response: {response_bytes.hex().upper()}"}

        frame_type = response_bytes[1]
        command_code_resp = response_bytes[2]
        param_len_resp = (response_bytes[3] << 8) + response_bytes[4]

        if frame_type == 0x02 and command_code_resp == 0x22: # Tag successfully read
            expected_params_len = 1 + 2 + 12 + 2 # RSSI(1) + PC(2) + EPC(12) + Tag_CRC(2) = 17 bytes
            if param_len_resp != expected_params_len:
                return {"status": "error", "message": f"Unexpected parameter length for tag data. Expected {expected_params_len}, Got {param_len_resp}."}
            
            params_start_index = 5
            rssi_raw = response_bytes[params_start_index]
            # RSSI conversion: Signed byte, (Value - 129) dBm according to some reader docs
            # Or just use raw if specific conversion isn't clear for E720 module series.
            # For now, let's assume it's a direct value or a placeholder.
            rssi_dbm = rssi_raw # Placeholder, actual conversion might be needed.

            pc_bytes = response_bytes[params_start_index+1 : params_start_index+1+2]
            pc_hex = pc_bytes.hex().upper()
            
            epc_bytes = response_bytes[params_start_index+1+2 : params_start_index+1+2+12]
            epc_hex = epc_bytes.hex().upper()
            
            # tag_crc_bytes = response_bytes[params_start_index+1+2+12 : params_start_index+1+2+12+2]
            # tag_crc_hex = tag_crc_bytes.hex().upper()

            return {
                "status": "success", 
                "epc_hex": epc_hex, 
                "rssi_dbm": rssi_dbm, 
                "pc_hex": pc_hex,
                "message": "Tag found."
            }
        
        elif frame_type == 0x01 and command_code_resp == 0xFF: # Operation failed or no tag
            error_code = response_bytes[5] # Assuming error code is at index 5
            if error_code == 0x15: # Specific error code for "No tag inventoried"
                return {"status": "no_tag_found", "message": "No tag found in inventory."}
            else:
                return {"status": "error", "message": f"Reader error code: {error_code:02X}."}
        
        else: # Unknown response type
            return {"status": "error", "message": f"Unknown response frame type: {frame_type:02X}, command: {command_code_resp:02X}. Full: {response_bytes.hex().upper()}"}

    def _perform_scan_attempt(self):
        """
        Performs a single RFID scan attempt. Assumes serial connection is ALREADY OPEN.
        This method does not manage connect/disconnect.
        Returns:
            dict: Parsed response from the reader.
        """
        if not self.is_connected or not self.serial_conn or not self.serial_conn.is_open:
            return {"status": "error", "message": "Serial port not connected or not open."}

        command = self._get_single_inventory_command()
        try:
            self.serial_conn.write(command)
            # The E720 module's response time is typically very fast.
            # A small explicit sleep here can be counterproductive if the serial timeout is set appropriately.
            # Rely on serial.Serial(timeout=...) for read operations.
            response_bytes = self.serial_conn.read(64) # Read up to 64 bytes
            return self._parse_response_data(response_bytes)
        except serial.SerialTimeoutException:
            return {"status": "error", "message": "Serial read timeout during scan attempt."}
        except serial.SerialException as e:
            return {"status": "error", "message": f"Serial communication error during scan: {str(e)}"}

    def scan_single_tag(self, wait_for_tag_timeout=10):
        """
        Scans for a single RFID tag, managing its own connection.
        Continuously tries to read a tag until one is found or the timeout is reached.

        Args:
            wait_for_tag_timeout (int, optional): Maximum time in seconds to wait for a tag.
                                                  If 0 or None, tries once.
        Returns:
            dict: A dictionary containing the scan result.
        """
        if not self.connect(): # Ensure connection
            return {"status": "error", "message": f"Failed to connect to serial port {self.port}"}

        start_time = time.time()
        try:
            while True:
                parsed_data = self._perform_scan_attempt()

                if parsed_data.get("status") == "success":
                    return parsed_data # Tag found
                
                # If not success, check for timeout or if single attempt was requested
                if wait_for_tag_timeout is None or wait_for_tag_timeout <= 0:
                    # If timeout is 0/None, this was a single attempt. Return its result.
                    return parsed_data 
                
                if (time.time() - start_time) > wait_for_tag_timeout:
                    # Timeout reached, return last status (could be no_tag_found or an error)
                    # If last attempt was an error, return that. Otherwise, specific timeout message.
                    if parsed_data.get("status") == "error":
                        return parsed_data 
                    return {"status": "no_tag_found", "message": f"Timeout: No tag found within {wait_for_tag_timeout} seconds."}
                
                time.sleep(0.05) # Brief pause before retrying to avoid busy-looping.
                                # Adjust if necessary. Should be short.
        finally:
            self.disconnect() # Always disconnect when this method exits
        
        # Fallback, should ideally not be reached due to logic above.
        return {"status": "error", "message": "Scan ended unexpectedly."}

if __name__ == "__main__":
    print("Testing RFIDReader class...")
    # Test with default port defined in class, or specify one:
    # reader = RFIDReader(port="COM_YOUR_READER") 
    reader = RFIDReader() 

    print("\nAttempting to connect...")
    if reader.connect():
        print("Connected successfully. Performing a single scan attempt using _perform_scan_attempt...")
        result_attempt = reader._perform_scan_attempt()
        print(f"Single Attempt Result: {result_attempt}")
        if result_attempt.get("status") == "success":
            epc = result_attempt.get("epc_hex")
            name = get_name_for_epc(epc)
            print(f"--> EPC: {epc}, Name: {name if name else 'Unknown'}")
        reader.disconnect()
        print("Disconnected.")
    else:
        print("Failed to connect for single attempt test.")

    print("\nTesting scan_single_tag (will wait up to 5 seconds)...")
    result_timed = reader.scan_single_tag(wait_for_tag_timeout=5) 
    print(f"Timed Scan Result: {result_timed}")
    if result_timed.get("status") == "success":
        epc_timed = result_timed.get("epc_hex")
        human_name_timed = get_name_for_epc(epc_timed)
        if human_name_timed:
            print(f"--> This tag is known as: {human_name_timed}")
        else:
            print(f"--> This tag EPC ({epc_timed}) is not found in the current mappings.")

    print("\nTesting scan_single_tag (quick scan, one attempt)...")
    result_quick = reader.scan_single_tag(wait_for_tag_timeout=0) # or wait_for_tag_timeout=None
    print(f"Quick Scan Result: {result_quick}")
    if result_quick.get("status") == "success":
        epc_quick = result_quick.get("epc_hex")
        human_name_quick = get_name_for_epc(epc_quick)
        if human_name_quick:
            print(f"--> This tag is known as: {human_name_quick}")
        else:
            print(f"--> This tag EPC ({epc_quick}) is not found in the current mappings.")
    
    print("\nRFIDReader test finished.")
