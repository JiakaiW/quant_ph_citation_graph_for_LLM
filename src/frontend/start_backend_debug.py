#!/usr/bin/env python3
"""
Debug-friendly startup script for the FastAPI backend server.
This script provides better monitoring and avoids file watching issues.
"""

import uvicorn
import sys
import os
import signal
import threading
import time
from datetime import datetime

# Add the current directory to the Python path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

def print_banner():
    """Print startup banner with system information."""
    print("=" * 60)
    print("🚀 Citation Network FastAPI Backend (Debug Mode)")
    print("=" * 60)
    print(f"📊 Database: ../../data/arxiv_papers.db")
    print(f"🌐 Server: http://localhost:8000")
    print(f"📖 API docs: http://localhost:8000/docs")
    print(f"🔍 Health check: http://localhost:8000/api/debug/health")
    print(f"📋 Debug info: http://localhost:8000/api/debug/database")
    print(f"📜 Recent logs: http://localhost:8000/api/debug/logs")
    print(f"🕒 Started: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"🔄 CORS enabled for: localhost:3000, localhost:5173")
    print("=" * 60)
    print()

def monitor_logs():
    """Monitor and display recent log entries."""
    log_file = "api_debug.log"
    if not os.path.exists(log_file):
        return
    
    # Get current file size
    try:
        with open(log_file, 'r') as f:
            f.seek(0, 2)  # Go to end
            last_pos = f.tell()
        
        while True:
            time.sleep(2)  # Check every 2 seconds
            try:
                with open(log_file, 'r') as f:
                    f.seek(last_pos)
                    new_lines = f.readlines()
                    if new_lines:
                        for line in new_lines:
                            if any(emoji in line for emoji in ['🌐', '✅', '❌', '⏰', '🗺️']):
                                print(f"[LOG] {line.strip()}")
                        last_pos = f.tell()
            except Exception:
                pass  # File might be being written to
    except Exception:
        pass  # Log file might not exist yet

def signal_handler(sig, frame):
    """Handle shutdown gracefully."""
    print("\n\n🛑 Shutting down server...")
    print("📊 Final stats available at: http://localhost:8000/api/debug/health")
    sys.exit(0)

if __name__ == "__main__":
    print_banner()
    
    # Set up signal handling
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)
    
    # Start log monitoring in background thread
    log_thread = threading.Thread(target=monitor_logs, daemon=True)
    log_thread.start()
    
    # Test database connection first
    try:
        print("🔍 Testing database connection...")
        import sqlite3
        conn = sqlite3.connect('../../data/arxiv_papers.db')
        cursor = conn.cursor()
        cursor.execute('SELECT COUNT(*) FROM filtered_papers')
        count = cursor.fetchone()[0]
        print(f"✅ Database OK: {count:,} papers available")
        conn.close()
    except Exception as e:
        print(f"❌ Database test failed: {e}")
        print("   Make sure the clustering pipeline has been run!")
        sys.exit(1)
    
    # Start the FastAPI server (no reload to avoid file watching issues)
    print("🚀 Starting FastAPI server...")
    print("   Press Ctrl+C to stop")
    print("   Server logs will appear below:")
    print("-" * 60)
    
    try:
        uvicorn.run(
            "backend_fastapi:app",
            host="0.0.0.0",
            port=8000,
            reload=False,  # Disable reload to avoid file watching
            log_level="info",
            access_log=True
        )
    except KeyboardInterrupt:
        signal_handler(None, None)
    except Exception as e:
        print(f"❌ Server failed to start: {e}")
        sys.exit(1) 