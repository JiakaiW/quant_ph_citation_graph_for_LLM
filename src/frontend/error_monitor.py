#!/usr/bin/env python3
"""
🔍 Frontend Error Monitor
Automatically monitor React frontend for JavaScript errors without manual browser interaction.
Usage: python error_monitor.py [--port 5173] [--watch] [--headless]
"""

import asyncio
import argparse
import json
import time
from datetime import datetime
from playwright.async_api import async_playwright
import aiohttp

class FrontendErrorMonitor:
    def __init__(self, port=5173, backend_port=8000, headless=True):
        self.frontend_url = f"http://localhost:{port}"
        self.backend_url = f"http://localhost:{backend_port}"
        self.headless = headless
        self.errors = []
        self.warnings = []
        self.console_logs = []
        
    async def check_backend_health(self):
        """Check if backend is running"""
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(f"{self.backend_url}/api/stats") as response:
                    if response.status == 200:
                        data = await response.json()
                        print(f"✅ Backend healthy: {data.get('total_papers', 'unknown')} papers")
                        return True
        except Exception as e:
            print(f"❌ Backend not reachable: {e}")
            return False
    
    async def monitor_page(self, duration_seconds=30):
        """Monitor frontend page for errors"""
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=self.headless)
            page = await browser.new_page()
            
            # Collect console messages
            page.on("console", self._on_console)
            page.on("pageerror", self._on_page_error)
            page.on("requestfailed", self._on_request_failed)
            
            try:
                print(f"🌐 Loading {self.frontend_url}...")
                await page.goto(self.frontend_url, wait_until="networkidle", timeout=10000)
                
                # Wait for React to load
                await page.wait_for_selector('div', timeout=5000)
                print("⚛️  React app loaded")
                
                # Check for specific Sigma.js container
                sigma_container = await page.query_selector('.sigma-container')
                if sigma_container:
                    bounds = await sigma_container.bounding_box()
                    if bounds and bounds['height'] > 0:
                        print(f"📏 Sigma container dimensions: {bounds['width']}x{bounds['height']}")
                    else:
                        print("⚠️  Sigma container has zero height!")
                else:
                    print("❌ Sigma container not found")
                
                # Monitor for specified duration
                print(f"👀 Monitoring for {duration_seconds} seconds...")
                await asyncio.sleep(duration_seconds)
                
            except Exception as e:
                print(f"❌ Error loading page: {e}")
            finally:
                await browser.close()
    
    def _on_console(self, msg):
        """Handle console messages"""
        timestamp = datetime.now().strftime("%H:%M:%S")
        message = {
            "timestamp": timestamp,
            "type": msg.type,
            "text": msg.text,
            "location": msg.location
        }
        
        if msg.type == "error":
            self.errors.append(message)
            print(f"🚨 [{timestamp}] ERROR: {msg.text}")
        elif msg.type == "warning":
            self.warnings.append(message)
            print(f"⚠️  [{timestamp}] WARN: {msg.text}")
        elif msg.type == "log":
            self.console_logs.append(message)
            # Only show non-verbose logs
            if not any(skip in msg.text.lower() for skip in ["vite", "hmr", "connected"]):
                print(f"📝 [{timestamp}] LOG: {msg.text}")
    
    def _on_page_error(self, error):
        """Handle uncaught page errors"""
        timestamp = datetime.now().strftime("%H:%M:%S")
        error_msg = {
            "timestamp": timestamp,
            "type": "uncaught_exception",
            "text": str(error),
            "stack": getattr(error, 'stack', None)
        }
        self.errors.append(error_msg)
        print(f"💥 [{timestamp}] UNCAUGHT: {error}")
    
    def _on_request_failed(self, request):
        """Handle failed network requests"""
        timestamp = datetime.now().strftime("%H:%M:%S")
        print(f"🌐 [{timestamp}] REQUEST FAILED: {request.url} - {request.failure}")
    
    def generate_report(self):
        """Generate error report"""
        print("\n" + "="*60)
        print("📊 FRONTEND ERROR REPORT")
        print("="*60)
        
        print(f"🚨 Errors: {len(self.errors)}")
        for error in self.errors[-5:]:  # Show last 5 errors
            print(f"   • [{error['timestamp']}] {error['text']}")
        
        print(f"\n⚠️  Warnings: {len(self.warnings)}")
        for warning in self.warnings[-3:]:  # Show last 3 warnings
            print(f"   • [{warning['timestamp']}] {warning['text']}")
        
        print(f"\n📝 Console logs: {len(self.console_logs)}")
        
        # Save detailed report
        report = {
            "timestamp": datetime.now().isoformat(),
            "summary": {
                "errors": len(self.errors),
                "warnings": len(self.warnings),
                "logs": len(self.console_logs)
            },
            "errors": self.errors,
            "warnings": self.warnings,
            "logs": self.console_logs[-10:]  # Last 10 logs
        }
        
        with open("frontend_error_report.json", "w") as f:
            json.dump(report, f, indent=2)
        
        print(f"\n💾 Detailed report saved to: frontend_error_report.json")
        return len(self.errors) == 0  # Return True if no errors

async def main():
    parser = argparse.ArgumentParser(description="Monitor frontend for errors")
    parser.add_argument("--port", type=int, default=5173, help="Frontend port")
    parser.add_argument("--backend-port", type=int, default=8000, help="Backend port")
    parser.add_argument("--duration", type=int, default=30, help="Monitor duration in seconds")
    parser.add_argument("--watch", action="store_true", help="Continuous monitoring")
    parser.add_argument("--headless", action="store_true", default=True, help="Run in headless mode")
    parser.add_argument("--visible", action="store_true", help="Show browser window")
    
    args = parser.parse_args()
    
    if args.visible:
        args.headless = False
    
    monitor = FrontendErrorMonitor(
        port=args.port, 
        backend_port=args.backend_port,
        headless=args.headless
    )
    
    # Check backend first
    backend_ok = await monitor.check_backend_health()
    if not backend_ok:
        print("⚠️  Backend not running. Start with: python start_backend.py")
    
    if args.watch:
        print("🔄 Continuous monitoring mode (Ctrl+C to stop)")
        try:
            while True:
                await monitor.monitor_page(args.duration)
                success = monitor.generate_report()
                
                if success:
                    print("✅ No errors detected")
                else:
                    print("❌ Errors found - check report")
                
                print(f"💤 Waiting 60 seconds before next check...")
                await asyncio.sleep(60)
                
                # Reset for next iteration
                monitor.errors = []
                monitor.warnings = []
                monitor.console_logs = []
                
        except KeyboardInterrupt:
            print("\n🛑 Monitoring stopped")
    else:
        # Single run
        await monitor.monitor_page(args.duration)
        success = monitor.generate_report()
        
        if success:
            print("✅ Frontend monitoring completed successfully")
            exit(0)
        else:
            print("❌ Errors detected in frontend")
            exit(1)

if __name__ == "__main__":
    asyncio.run(main()) 