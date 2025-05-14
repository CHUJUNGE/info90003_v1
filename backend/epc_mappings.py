# epc_mappings.py

# This dictionary maps RFID EPC codes (hex strings) to human-readable names.
EPC_TO_NAME_MAP = {
    "E280F3372000F0000FDAE3BA": "cup",
    "E280F3372000F0000FDAED20": "knife",
    "E280F3372000F0000FDAF9A8": "phone",
    "E280F3372000F0000FDAD0F6": "monitor",
    # Add more mappings here as needed, for example:
    # "ANOTHER_EPC_CODE_HERE": "book",
    # "YET_ANOTHER_EPC": "keychain",
}

def get_name_for_epc(epc_hex):
    """Looks up the human-readable name for a given EPC.
    
    Args:
        epc_hex (str): The EPC hex string.
        
    Returns:
        str: The human-readable name if found, otherwise None.
    """
    return EPC_TO_NAME_MAP.get(epc_hex)
