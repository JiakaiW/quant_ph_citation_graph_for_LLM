#!/usr/bin/env python3
"""
🔬 Comprehensive System Test
Automatically starts backend, frontend, and monitors for errors.
Usage: python test_system.py [--duration 60] [--install-deps]
"""

import asyncio
import subprocess
import time
import signal
import sys
import argparse
import json
from pathlib import Path

class SystemTester:
    def __init__(self, duration=60, install_deps=False):
        self.duration = duration
        self.install_deps = install_deps
        self.processes = []
        self.success = True
        
    def cleanup(self):
        """Clean up all processes"""
        print("\n🧹 Cleaning up processes...")
        for proc in self.processes:
            try:
                proc.terminate()
                proc.wait(timeout=5)
            except:
                try:
                    proc.kill()
                except:
                    pass
    
    def install_dependencies(self):
        """Install required dependencies"""
        print("📦 Installing Python dependencies...")
        try:
            subprocess.run([sys.executable, "-m", "pip", "install", "-r", "requirements.txt"], 
                         check=True, capture_output=True)
            print("✅ Python dependencies installed")
        except subprocess.CalledProcessError as e:
            print(f"❌ Failed to install Python deps: {e}")
            return False
        
        # Install Playwright browsers
        print("🌐 Installing Playwright browsers...")
        try:
            subprocess.run([sys.executable, "-m", "playwright", "install", "chromium"], 
                         check=True, capture_output=True)
            print("✅ Playwright browsers installed")
        except subprocess.CalledProcessError as e:
            print(f"❌ Failed to install Playwright: {e}")
            return False
        
        return True
    
    def start_backend(self):
        """Start the FastAPI backend"""
        print("🚀 Starting backend server...")
        try:
            proc = subprocess.Popen(
                [sys.executable, "start_backend.py"],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True
            )
            self.processes.append(proc)
            
            # Wait a bit for startup
            time.sleep(3)
            
            if proc.poll() is None:  # Still running
                print("✅ Backend started successfully")
                return True
            else:
                stdout, stderr = proc.communicate()
                print(f"❌ Backend failed to start:")
                print(f"   STDOUT: {stdout}")
                print(f"   STDERR: {stderr}")
                return False
                
        except Exception as e:
            print(f"❌ Failed to start backend: {e}")
            return False
    
    def start_frontend(self):
        """Start the Vite frontend dev server"""
        print("⚛️  Starting frontend server...")
        try:
            # Use nvm environment for npm
            nvm_env = {
                "NODE_ENV": "development",
                "PATH": "/usr/bin:/bin:/usr/local/bin",
                "NVM_DIR": "/home/kai/.nvm"
            }
            
            # Start frontend in background with proper npm path
            cmd = 'export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" && npm run dev'
            proc = subprocess.Popen(
                cmd,
                shell=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                env=nvm_env
            )
            self.processes.append(proc)
            
            # Wait for startup
            print("⏳ Waiting for frontend to start...")
            time.sleep(5)
            
            if proc.poll() is None:  # Still running
                print("✅ Frontend started successfully")
                return True
            else:
                stdout, stderr = proc.communicate()
                print(f"❌ Frontend failed to start:")
                print(f"   STDOUT: {stdout}")
                print(f"   STDERR: {stderr}")
                return False
                
        except Exception as e:
            print(f"❌ Failed to start frontend: {e}")
            return False
    
    async def run_error_monitor(self):
        """Run the error monitoring system"""
        print(f"👀 Starting error monitor for {self.duration} seconds...")
        
        try:
            # Import and run the error monitor
            from error_monitor import FrontendErrorMonitor
            
            monitor = FrontendErrorMonitor(
                port=5173,
                backend_port=8000,
                headless=True
            )
            
            await monitor.monitor_page(self.duration)
            success = monitor.generate_report()
            
            if success:
                print("✅ No frontend errors detected!")
                return True
            else:
                print("❌ Frontend errors detected - check reports")
                self.success = False
                return False
                
        except Exception as e:
            print(f"❌ Error monitor failed: {e}")
            self.success = False
            return False
    
    def check_outputs(self):
        """Check for expected output files"""
        print("📁 Checking output files...")
        
        expected_files = [
            "api_debug.log",
            "frontend_error_report.json"
        ]
        
        for filename in expected_files:
            if Path(filename).exists():
                print(f"✅ Found {filename}")
            else:
                print(f"⚠️  Missing {filename}")
    
    async def run_full_test(self):
        """Run the complete system test"""
        print("🔬 COMPREHENSIVE SYSTEM TEST")
        print("=" * 50)
        
        # Install dependencies if requested
        if self.install_deps:
            if not self.install_dependencies():
                return False
        
        try:
            # Start services
            if not self.start_backend():
                return False
            
            if not self.start_frontend():
                return False
            
            # Run monitoring
            await self.run_error_monitor()
            
            # Check outputs
            self.check_outputs()
            
            return self.success
            
        finally:
            self.cleanup()

def signal_handler(signum, frame):
    """Handle Ctrl+C gracefully"""
    print("\n🛑 Test interrupted by user")
    sys.exit(1)

async def main():
    parser = argparse.ArgumentParser(description="Comprehensive system test")
    parser.add_argument("--duration", type=int, default=60, help="Test duration in seconds")
    parser.add_argument("--install-deps", action="store_true", help="Install dependencies first")
    parser.add_argument("--quick", action="store_true", help="Quick 15-second test")
    
    args = parser.parse_args()
    
    if args.quick:
        args.duration = 15
    
    # Handle Ctrl+C
    signal.signal(signal.SIGINT, signal_handler)
    
    tester = SystemTester(duration=args.duration, install_deps=args.install_deps)
    
    try:
        success = await tester.run_full_test()
        
        print("\n" + "=" * 50)
        if success:
            print("🎉 SYSTEM TEST PASSED!")
            print("✅ Both backend and frontend are working correctly")
            print("✅ No JavaScript errors detected")
            exit(0)
        else:
            print("❌ SYSTEM TEST FAILED!")
            print("🔍 Check the logs and error reports for details")
            exit(1)
            
    except KeyboardInterrupt:
        print("\n🛑 Test interrupted")
        tester.cleanup()
        exit(1)
    except Exception as e:
        print(f"\n💥 Unexpected error: {e}")
        tester.cleanup()
        exit(1)

if __name__ == "__main__":
    asyncio.run(main()) 