"""
Sample data loader for PulseAI Lite.
Reads data_pos.txt and replays at configurable speed.
"""

import asyncio
import json
import logging
from pathlib import Path
from typing import AsyncIterator, Callable, List

log = logging.getLogger("sample-loader")

# Configurable delay between records (seconds)
SAMPLE_DELAY = 0.5  # 0.5s = 2 records per second


def load_all_sample_data(file_path: Path) -> List[dict]:
    """
    Load all sample data at once for batch processing.
    
    Args:
        file_path: Path to data_pos.txt
        
    Returns:
        List of all data points
    """
    if not file_path.exists():
        log.error(f"Sample file not found: {file_path}")
        return []
    
    data_list = []
    with open(file_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                data = json.loads(line)
                data_list.append(data)
            except json.JSONDecodeError:
                continue
    
    log.info(f"Loaded {len(data_list)} records from {file_path}")
    return data_list


async def load_sample_file(
    file_path: Path,
    on_data: Callable[[dict], None],
    loop: bool = False,
) -> None:
    """
    Load sample file and replay at fixed speed.
    
    Args:
        file_path: Path to data_pos.txt
        on_data: Callback function for each data point
        loop: Whether to loop the file
    """
    if not file_path.exists():
        log.error(f"Sample file not found: {file_path}")
        return

    log.info(f"Loading sample file: {file_path}")
    
    while True:
        line_count = 0
        
        with open(file_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                
                try:
                    data = json.loads(line)
                except json.JSONDecodeError as e:
                    log.warning(f"Invalid JSON at line {line_count}: {e}")
                    continue
                
                # Fixed delay for consistent playback
                await asyncio.sleep(SAMPLE_DELAY)
                
                # Call the data handler
                on_data(data)
                line_count += 1
                
                if line_count % 100 == 0:
                    log.info(f"Processed {line_count} records")
        
        log.info(f"Finished processing {line_count} records")
        
        if not loop:
            break
        
        log.info("Looping sample file...")
        await asyncio.sleep(1)


async def sample_data_generator(
    file_path: Path,
    loop: bool = False,
) -> AsyncIterator[dict]:
    """
    Async generator that yields data points at fixed speed.
    
    Args:
        file_path: Path to data_pos.txt
        loop: Whether to loop the file
        
    Yields:
        dict: Parsed data point
    """
    if not file_path.exists():
        log.error(f"Sample file not found: {file_path}")
        return

    log.info(f"Loading sample file: {file_path}")
    
    while True:
        line_count = 0
        
        with open(file_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                
                try:
                    data = json.loads(line)
                except json.JSONDecodeError:
                    continue
                
                # Fixed delay for consistent playback
                await asyncio.sleep(SAMPLE_DELAY)
                
                yield data
                line_count += 1
        
        log.info(f"Finished processing {line_count} records")
        
        if not loop:
            break
        
        log.info("Looping sample file...")
        await asyncio.sleep(1)
