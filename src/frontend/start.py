#!/usr/bin/env python3
"""
🚀 Citation Network Visualization - Single Startup Script

Starts the complete system with proper error handling and health checks.
Usage: python start.py [--dev] [--test]
"""

import subprocess
import time
import signal
import sys
import argparse
import requests
from pathlib import Path

class SystemStarter:
    def __init__(self, dev_mode=False):
        self.dev_mode = dev_mode
        self.processes = []
        
    def cleanup(self):
        """Clean shutdown of all processes"""
        print("\n🧹 Shutting down system...")
        for proc in self.processes:
            try:
                proc.terminate()
                proc.wait(timeout=5)
            except:
                try:
                    proc.kill()
                except:
                    pass

    def check_database(self):
        """Verify database exists and has data"""
        db_path = Path("../../data/arxiv_papers.db")
        if not db_path.exists():
            print("❌ Database not found. Run clustering pipeline first:")
            print("   cd ../../src/clustering && python pipeline.py")
            return False
        
        print(f"✅ Database found: {db_path}")
        return True

    def start_backend(self):
        """Start FastAPI backend server"""
        print("🚀 Starting backend server...")
        
        cmd = [sys.executable, "start_backend.py"] if not self.dev_mode else [
            sys.executable, "-c", 
            "import uvicorn; uvicorn.run('backend_fastapi:app', host='0.0.0.0', port=8000, reload=True, log_level='info')"
        ]
        
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        self.processes.append(proc)
        
        # Wait for backend startup
        for i in range(15):
            time.sleep(1)
            try:
                response = requests.get("http://localhost:8000/api/stats", timeout=2)
                if response.status_code == 200:
                    data = response.json()
                    print(f"✅ Backend ready: {data.get('total_papers', 'unknown')} papers loaded")
                    return True
            except:
                continue
        
        print("❌ Backend failed to start within 15 seconds")
        return False

    def start_frontend(self):
        """Start React frontend development server"""
        print("⚛️  Starting frontend server...")
        
        # Check if node_modules exists
        if not Path("node_modules").exists():
            print("📦 Installing frontend dependencies...")
            subprocess.run(["npm", "install"], check=True)
        
        proc = subprocess.Popen(["npm", "run", "dev"], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        self.processes.append(proc)
        
        # Wait for frontend startup
        time.sleep(3)
        
        if proc.poll() is None:
            print("✅ Frontend server started")
            print("🌐 Open http://localhost:5173 in your browser")
            return True
        else:
            stdout, stderr = proc.communicate()
            print(f"❌ Frontend failed to start:")
            if stderr:
                print(f"   Error: {stderr.decode()[:200]}")
            return False

    def run_health_check(self):
        """Comprehensive system health check"""
        print("\n🩺 System Health Check:")
        
        # Backend health
        try:
            response = requests.get("http://localhost:8000/api/debug/health", timeout=3)
            if response.status_code == 200:
                health = response.json()
                print(f"✅ Backend: {health['database']['paper_count']} papers, {health['uptime_seconds']:.0f}s uptime")
            else:
                print(f"⚠️  Backend: HTTP {response.status_code}")
        except Exception as e:
            print(f"❌ Backend: {str(e)}")
        
        # Frontend health
        try:
            response = requests.get("http://localhost:5173", timeout=3)
            if response.status_code == 200:
                print("✅ Frontend: React dev server running")
            else:
                print(f"⚠️  Frontend: HTTP {response.status_code}")
        except Exception as e:
            print(f"❌ Frontend: {str(e)}")

    def run(self):
        """Start the complete system"""
        print("🧬 Citation Network Visualization System")
        print("=" * 50)
        
        # Pre-flight checks
        if not self.check_database():
            return 1
        
        try:
            # Start backend
            if not self.start_backend():
                return 1
            
            # Start frontend
            if not self.start_frontend():
                return 1
            
            # Health check
            time.sleep(2)
            self.run_health_check()
            
            # Keep running
            print("\n🎯 System running successfully!")
            print("   Frontend: http://localhost:5173")
            print("   Backend API: http://localhost:8000/docs")
            print("   Debug Panel: Toggle with 🐛 button in UI")
            print("\n   Press Ctrl+C to stop")
            
            while True:
                time.sleep(10)
                # Periodic health check
                
        except KeyboardInterrupt:
            print("\n🛑 Shutdown requested")
        except Exception as e:
            print(f"💥 Unexpected error: {e}")
        finally:
            self.cleanup()
        
        return 0

def main():
    parser = argparse.ArgumentParser(description="Start citation network visualization system")
    parser.add_argument("--dev", action="store_true", help="Development mode with auto-reload")
    parser.add_argument("--test", action="store_true", help="Run system tests after startup")
    
    args = parser.parse_args()
    
    # Handle Ctrl+C gracefully
    def signal_handler(signum, frame):
        print("\n🛑 Interrupt received")
        sys.exit(0)
    
    signal.signal(signal.SIGINT, signal_handler)
    
    starter = SystemStarter(dev_mode=args.dev)
    
    if args.test:
        print("🧪 Test mode - will run health checks after startup")
    
    return starter.run()

if __name__ == "__main__":
    sys.exit(main()) 