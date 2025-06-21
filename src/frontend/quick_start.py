#!/usr/bin/env python3
"""
🚀 Quick Start Script
Simple script to start backend and frontend services with error monitoring.
Usage: python quick_start.py [--test-only] [--monitor]
"""

import subprocess
import time
import sys
import argparse
from pathlib import Path
import signal
import requests

class QuickStarter:
    def __init__(self):
        self.processes = []
        self.backend_proc = None
        self.frontend_proc = None
        
    def cleanup(self):
        """Clean up all processes"""
        print("\n🧹 Shutting down services...")
        for proc in self.processes:
            try:
                proc.terminate()
                proc.wait(timeout=5)
            except:
                try:
                    proc.kill()
                except:
                    pass
    
    def start_backend(self):
        """Start the FastAPI backend"""
        print("🚀 Starting backend server...")
        try:
            self.backend_proc = subprocess.Popen(
                [sys.executable, "start_backend.py"],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE
            )
            self.processes.append(self.backend_proc)
            
            # Wait for backend to start
            for i in range(10):
                time.sleep(1)
                try:
                    response = requests.get("http://localhost:8000/api/stats", timeout=2)
                    if response.status_code == 200:
                        data = response.json()
                        print(f"✅ Backend ready: {data.get('total_papers', 'unknown')} papers")
                        return True
                except:
                    continue
            
            print("❌ Backend failed to start properly")
            return False
            
        except Exception as e:
            print(f"❌ Failed to start backend: {e}")
            return False
    
    def start_frontend(self):
        """Start the Vite frontend"""
        print("⚛️  Starting frontend server...")
        try:
            # Use shell command with nvm environment
            cmd = 'export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" && npm run dev'
            
            self.frontend_proc = subprocess.Popen(
                cmd,
                shell=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE
            )
            self.processes.append(self.frontend_proc)
            
            # Wait for frontend to start
            print("⏳ Waiting for frontend startup...")
            time.sleep(5)
            
            if self.frontend_proc.poll() is None:
                print("✅ Frontend server started")
                print("🌐 Open http://localhost:5173 in your browser")
                return True
            else:
                stdout, stderr = self.frontend_proc.communicate()
                print(f"❌ Frontend failed to start:")
                if stderr:
                    print(f"   Error: {stderr.decode()[:200]}")
                return False
                
        except Exception as e:
            print(f"❌ Failed to start frontend: {e}")
            return False
    
    def check_health(self):
        """Check health of running services"""
        print("\n🩺 Health Check:")
        
        # Check backend
        try:
            response = requests.get("http://localhost:8000/api/stats", timeout=2)
            if response.status_code == 200:
                data = response.json()
                print(f"✅ Backend: {data.get('total_papers')} papers, {data.get('total_clusters')} clusters")
            else:
                print(f"⚠️  Backend: HTTP {response.status_code}")
        except Exception as e:
            print(f"❌ Backend: Not reachable ({e})")
        
        # Check frontend
        try:
            response = requests.get("http://localhost:5173", timeout=2)
            if response.status_code == 200:
                print("✅ Frontend: Running on port 5173")
            else:
                print(f"⚠️  Frontend: HTTP {response.status_code}")
        except Exception as e:
            print(f"❌ Frontend: Not reachable ({e})")
    
    def wait_for_services(self):
        """Wait for services and monitor"""
        print("\n🔄 Services running. Press Ctrl+C to stop.")
        print("📊 Debug panel: Toggle with the debug button in the frontend")
        print("🔍 Monitor errors: python error_monitor.py --visible --duration 30")
        
        try:
            while True:
                time.sleep(30)
                self.check_health()
        except KeyboardInterrupt:
            print("\n🛑 Stopping services...")
            self.cleanup()

def main():
    parser = argparse.ArgumentParser(description="Quick start backend and frontend")
    parser.add_argument("--test-only", action="store_true", help="Just test startup, then exit")
    parser.add_argument("--monitor", action="store_true", help="Run error monitor after startup")
    
    args = parser.parse_args()
    
    starter = QuickStarter()
    
    # Handle Ctrl+C
    def signal_handler(signum, frame):
        starter.cleanup()
        sys.exit(0)
    
    signal.signal(signal.SIGINT, signal_handler)
    
    try:
        # Start services
        if not starter.start_backend():
            print("❌ Cannot continue without backend")
            return 1
        
        if not starter.start_frontend():
            print("❌ Cannot continue without frontend")
            return 1
        
        time.sleep(2)
        starter.check_health()
        
        if args.test_only:
            print("\n✅ Test complete - both services started successfully")
            starter.cleanup()
            return 0
        
        if args.monitor:
            print("\n👀 Starting error monitor...")
            try:
                subprocess.run([sys.executable, "error_monitor.py", "--visible", "--duration", "30"])
            except Exception as e:
                print(f"⚠️  Could not start error monitor: {e}")
        
        # Keep services running
        starter.wait_for_services()
        
    except Exception as e:
        print(f"💥 Unexpected error: {e}")
        starter.cleanup()
        return 1
    
    return 0

if __name__ == "__main__":
    sys.exit(main()) 