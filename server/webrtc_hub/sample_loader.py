"""
Sample data loader for PulseAI Lite.
Reads data_pos.txt and replays at real-time speed.
"""

import asyncio
import json
import logging
from datetime import datetime
from pathlib import Path
from typing import AsyncIterator, Callable, Optional

log = logging.getLogger("sample-loader")


def parse_timestamp(ts_str: str) -> datetime:
    """Parse timestamp string to datetime."""
    return datetime.strptime(ts_str, "%Y-%m-%d %H:%M:%S")


async def load_sample_file(
    file_path: Path,
    on_data: Callable[[dict], None],
    loop: bool = False,
) -> None:
    """
    Load sample file and replay at real-time speed.
    
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
        prev_ts: Optional[datetime] = None
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
                
                # Get timestamp for delay calculation
                ts_str = data.get("Timestamp")
                if ts_str:
                    try:
                        current_ts = parse_timestamp(ts_str)
                        
                        # Calculate delay based on timestamp difference
                        if prev_ts is not None:
                            delay = abs(current_ts - prev_ts).total_seconds()
                            # Use absolute value and ensure minimum delay
                            delay = max(0.1, min(delay, 5.0))  # 0.1s ~ 5s
                            await asyncio.sleep(delay)
                        else:
                            # First record - small delay
                            await asyncio.sleep(0.1)
                        
                        prev_ts = current_ts
                    except ValueError:
                        pass
                
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
    Async generator that yields data points at real-time speed.
    
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
        prev_ts: Optional[datetime] = None
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
                
                # Get timestamp for delay calculation
                ts_str = data.get("Timestamp")
                if ts_str:
                    try:
                        current_ts = parse_timestamp(ts_str)
                        
                        # Calculate delay based on timestamp difference
                        if prev_ts is not None:
                            delay = abs(current_ts - prev_ts).total_seconds()
                            # Use absolute value and ensure minimum delay
                            delay = max(0.1, min(delay, 5.0))  # 0.1s ~ 5s
                            await asyncio.sleep(delay)
                        else:
                            # First record - small delay
                            await asyncio.sleep(0.1)
                        
                        prev_ts = current_ts
                    except ValueError:
                        pass
                
                yield data
                line_count += 1
        
        log.info(f"Finished processing {line_count} records")
        
        if not loop:
            break
        
        log.info("Looping sample file...")
        await asyncio.sleep(1)
