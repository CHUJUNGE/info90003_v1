import serial
import time
from .epc_mappings import get_name_for_epc

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
        self.timeout = timeout
        self.serial_conn = None
        self.is_connected = False

    def connect(self):
        if self.is_connected:
            return True
        try:
            self.serial_conn = serial.Serial(self.port, self.baudrate, timeout=self.timeout)
            self.is_connected = True
            # print(f"Successfully connected to {self.port} at {self.baudrate} baud.")
            return True
        except serial.SerialException as e:
            print(f"RFID Reader: Serial connection error on {self.port}: {e}")
            self.is_connected = False
            return False

    def disconnect(self):
        if self.serial_conn and self.serial_conn.is_open:
            self.serial_conn.close()
        self.is_connected = False
        self.serial_conn = None # Important to reset
        # print("RFID Reader: Serial port closed.")

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
        
        # Debug print for raw response
        print(f"RFID Reader DEBUG: Raw response_bytes (len={len(response_bytes)}): {response_bytes.hex().upper() if response_bytes else 'None'}")

        # Minimum length for any valid frame (e.g., error response is 8 bytes)
        if len(response_bytes) < 8:
            return {"status": "error", "message": f"Response too short ({len(response_bytes)} bytes): {response_bytes.hex().upper()}"}

        if response_bytes[0] != 0xBB or response_bytes[-1] != 0x7E:
            return {"status": "error", "message": f"Invalid frame start/end bytes: {response_bytes.hex().upper()}"}
        
        # Verify checksum of the received frame
        # Data for checksum: Type, Cmd, PL_MSB, PL_LSB, ..., up to (but not including) CHK byte
        data_for_checksum_calc = list(response_bytes[1:-2])
        received_checksum_byte = response_bytes[-2]
        calculated_response_checksum = calculate_checksum(data_for_checksum_calc)

        if received_checksum_byte != calculated_response_checksum:
            return {"status": "error", "message": f"Response checksum mismatch. Expected {calculated_response_checksum:02X}, Got {received_checksum_byte:02X}. Response: {response_bytes.hex().upper()}"}

        frame_type = response_bytes[1]
        command_code_resp = response_bytes[2]
        param_len_resp = (response_bytes[3] << 8) + response_bytes[4]

        # Case 1: Tag successfully read (response to command 0x22)
        # Format: BB 02 22 00 11 RSSI(1B) PC(2B) EPC(12B) Tag_CRC(2B) CHK(1B) 7E
        if frame_type == 0x02 and command_code_resp == 0x22:
            expected_total_len = 1 + 1 + 1 + 2 + param_len_resp + 1 + 1 # BB+Type+Cmd+PL+Params+CHK+7E
            if len(response_bytes) != expected_total_len:
                 return {"status": "error", "message": f"Successful read response length mismatch. Expected {expected_total_len}, Got {len(response_bytes)} bytes."}
            if param_len_resp != 17: # RSSI(1) + PC(2) + EPC(12) + Tag_CRC(2) = 17
                return {"status": "error", "message": f"Unexpected parameter length in success response: {param_len_resp}. Expected 17."}

            rssi_raw = response_bytes[5]
            rssi_dbm = rssi_raw if rssi_raw <= 127 else rssi_raw - 256 # Convert to signed byte
            pc_hex = response_bytes[6:8].hex().upper()
            epc_hex = response_bytes[8:20].hex().upper()
            # tag_crc_hex = response_bytes[20:22].hex().upper() # CRC from tag itself, not usually used by app
            
            return {
                "status": "success",
                "rssi_dbm": rssi_dbm,
                "pc_hex": pc_hex,
                "epc_hex": epc_hex
            }
        
        # Case 2: No tag found (response to command 0x22)
        # Format: BB 01 FF 00 01 ERR_CODE CHK 7E
        elif frame_type == 0x01 and command_code_resp == 0xFF:
            expected_total_len = 1 + 1 + 1 + 2 + param_len_resp + 1 + 1
            if len(response_bytes) != expected_total_len:
                 return {"status": "error", "message": f"No-tag/Error response length mismatch. Expected {expected_total_len}, Got {len(response_bytes)} bytes."}
            if param_len_resp != 1: # Error code is 1 byte
                 return {"status": "error", "message": f"Unexpected parameter length in no-tag/error response: {param_len_resp}. Expected 1."}

            error_code = response_bytes[5]
            if error_code == 0x15: # Error code 0x15 means "No tag inventoried"
                return {"status": "no_tag_found"}
            else:
                return {"status": "reader_error", "error_code": f"0x{error_code:02X}"}

        else:
            return {"status": "unknown_response", "raw_response": response_bytes.hex().upper()}

    def scan_single_tag(self, wait_for_tag_timeout=60):
        """Scans for a single RFID tag.

        Continuously tries to read a tag until one is found or the timeout is reached.

        Args:
            wait_for_tag_timeout (int, optional): Maximum time in seconds to wait for a tag.
                                                 Defaults to 60 seconds.
                                                 If 0 or None, it will try only once.

        Returns:
            dict: A dictionary containing the scan result.
                  Keys might include 'status', 'epc_hex', 'rssi_dbm', 'pc_hex', 'message'.
        """
        if not self.connect(): # Try to connect first
            return {"status": "error", "message": f"Failed to connect to serial port {self.port}"}

        start_time = time.time()
        try:
            while True:
                command = self._get_single_inventory_command()
                # print(f"RFID Reader: Sending command: {command.hex().upper()}")
                try:
                    self.serial_conn.write(command)
                except serial.SerialException as e:
                    return {"status": "error", "message": f"Serial write error: {str(e)}"}
                
                # Wait a brief moment for the reader to process and respond
                # The E720 reader is quite fast, but a small delay might be needed if issues occur.
                # time.sleep(0.05) # 50ms, adjust if necessary
                
                try:
                    response_bytes = self.serial_conn.read(64) # Read up to 64 bytes, adjust size if needed
                except serial.SerialTimeoutException:
                    # This can happen if timeout is very short and no tag is present
                    response_bytes = b'' 
                except serial.SerialException as e:
                    return {"status": "error", "message": f"Serial read error: {str(e)}"}

                # Debug print for raw response if needed during development
                # print(f"RFID Reader DEBUG: Raw response_bytes (len={len(response_bytes)}): {response_bytes.hex().upper() if response_bytes else 'None'}")

                parsed_data = self._parse_response_data(response_bytes)

                if parsed_data.get("status") == "success":
                    return parsed_data # Tag found, return immediately
                
                # If not success, check for timeout or if single attempt was requested
                if wait_for_tag_timeout is None or wait_for_tag_timeout <= 0:
                    return parsed_data # Return whatever was found (e.g., no_tag_found or error)
                
                if (time.time() - start_time) > wait_for_tag_timeout:
                    return {"status": "no_tag_found", "message": f"Timeout: No tag found within {wait_for_tag_timeout} seconds."}
                
                time.sleep(0.1) # Brief pause before retrying to avoid busy-looping and give reader a chance

        finally:
            self.disconnect()
        
        # Should not be reached if logic is correct, but as a fallback:
        return {"status": "error", "message": "Scan ended unexpectedly."}


if __name__ == "__main__":
    print("Testing RFIDReader class...")
    reader = RFIDReader() # Use default port defined in class

    print("\nAttempting to scan a tag (will wait up to 10 seconds)...")
    # Test with a longer timeout
    result = reader.scan_single_tag(wait_for_tag_timeout=10) 
    print(f"Scan Result: {result}")
    if result.get("status") == "success":
        epc = result.get("epc_hex")
        if epc:
            human_name = get_name_for_epc(epc)
            if human_name:
                print(f"--> This tag is known as: {human_name}")
            else:
                print(f"--> This tag EPC ({epc}) is not found in the current mappings.")

    print("\nAttempting to scan again (will try once, effectively a quick scan)...")
    result_quick = reader.scan_single_tag(wait_for_tag_timeout=0)
    print(f"Quick Scan Result: {result_quick}")
    if result_quick.get("status") == "success":
        epc_quick = result_quick.get("epc_hex")
        if epc_quick:
            human_name_quick = get_name_for_epc(epc_quick)
            if human_name_quick:
                print(f"--> This tag is known as: {human_name_quick}")
            else:
                print(f"--> This tag EPC ({epc_quick}) is not found in the current mappings.")

    print("\nRFIDReader test finished.")
