#!/usr/bin/env python3
"""
GPU monitoring script to track NVIDIA GPU usage during pipeline execution.
Run this in a separate terminal while running your clustering pipeline.
"""

import subprocess
import time
import os
import threading
import signal
import sys

def monitor_gpu_usage(interval=1):
    """Monitor GPU usage and display real-time stats."""
    print("🔍 GPU Monitor Started")
    print("=" * 60)
    print("Time     | GPU% | Mem Used | Mem Total | Temp | Power")
    print("=" * 60)
    
    try:
        while True:
            # Get GPU stats using nvidia-smi
            result = subprocess.run([
                'nvidia-smi', 
                '--query-gpu=utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw',
                '--format=csv,noheader,nounits'
            ], capture_output=True, text=True)
            
            if result.returncode == 0:
                stats = result.stdout.strip().split(', ')
                gpu_util = stats[0]
                mem_used = stats[1]
                mem_total = stats[2]
                temp = stats[3]
                power = stats[4]
                
                # Color coding for GPU utilization
                if int(gpu_util) > 50:
                    gpu_color = "\033[92m"  # Green
                elif int(gpu_util) > 10:
                    gpu_color = "\033[93m"  # Yellow
                else:
                    gpu_color = "\033[91m"  # Red
                
                timestamp = time.strftime("%H:%M:%S")
                print(f"{timestamp} | {gpu_color}{gpu_util:>3}%\033[0m | {mem_used:>4} MB | {mem_total:>4} MB | {temp:>3}°C | {power:>4}W")
            else:
                print("❌ Failed to get GPU stats")
            
            time.sleep(interval)
            
    except KeyboardInterrupt:
        print("\n🛑 GPU monitoring stopped")

def monitor_processes():
    """Monitor GPU processes."""
    print("\n🔍 GPU Process Monitor")
    print("=" * 40)
    
    result = subprocess.run([
        'nvidia-smi', 
        '--query-compute-apps=pid,process_name,used_memory',
        '--format=csv,noheader'
    ], capture_output=True, text=True)
    
    if result.returncode == 0 and result.stdout.strip():
        print("Active GPU processes:")
        for line in result.stdout.strip().split('\n'):
            print(f"  {line}")
    else:
        print("No active GPU processes found")

def signal_handler(sig, frame):
    """Handle Ctrl+C gracefully."""
    print("\n🛑 Stopping GPU monitor...")
    sys.exit(0)

if __name__ == "__main__":
    # Set up signal handler for graceful exit
    signal.signal(signal.SIGINT, signal_handler)
    
    print("🚀 Starting GPU Monitor")
    print("Press Ctrl+C to stop")
    print()
    
    # Show initial process status
    monitor_processes()
    print()
    
    # Start monitoring
    monitor_gpu_usage(interval=0.5)  # Update every 0.5 seconds 