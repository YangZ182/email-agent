"""Render the isolated fixture page in the installed Edge browser."""

import asyncio
import base64
import json
from pathlib import Path
import subprocess
import sys
import tempfile

import httpx
from websockets.asyncio.client import connect


class Page:
    def __init__(self, socket):
        self.socket, self.sequence = socket, 0
        self.http = httpx.AsyncClient(trust_env=False)
        self.assets = {}

    async def call(self, method, params=None):
        self.sequence += 1
        call_id = self.sequence
        await self.socket.send(json.dumps({"id": call_id, "method": method, "params": params or {}}))
        while True:
            result = json.loads(await self.socket.recv())
            if result.get("method") == "Network.loadingFailed":
                print("Browser resource failure:", result["params"].get("errorText"))
            if result.get("method") == "Fetch.requestPaused":
                request = result["params"]
                # Only local static assets are fulfilled; the live app websocket remains real.
                url = request["request"]["url"]
                if url not in self.assets:
                    self.assets[url] = await self.http.get(url)
                response = self.assets[url]
                self.sequence += 1
                await self.socket.send(json.dumps({"id": self.sequence, "method": "Fetch.fulfillRequest", "params": {
                    "requestId": request["requestId"], "responseCode": response.status_code,
                    "responseHeaders": [{"name": "Content-Type", "value": response.headers.get("content-type", "application/octet-stream")}],
                    "body": base64.b64encode(response.content).decode()}}))
            if result.get("id") == call_id:
                if "error" in result:
                    raise RuntimeError(result["error"])
                return result.get("result", {})

    async def evaluate(self, expression):
        result = await self.call("Runtime.evaluate", {"expression": expression, "returnByValue": True})
        if "exceptionDetails" in result:
            raise RuntimeError(result["exceptionDetails"])
        return result.get("result", {}).get("value")

    async def wait(self, text):
        for _ in range(240):
            if await self.evaluate(f"document.body && document.body.innerText.includes({json.dumps(text)})"):
                return
            await asyncio.sleep(.25)
        raise AssertionError("Missing UI text: " + text + "\n" + str(await self.evaluate("document.body.innerText")))

    async def click(self, text, settle=1.5):
        for _ in range(120):
            if await self.evaluate("Array.from(document.querySelectorAll('button')).some(x=>x.innerText.trim()===" + json.dumps(text) + "&&!x.disabled)"):
                break
            await asyncio.sleep(.25)
        else:
            raise AssertionError("Missing enabled button: " + text + "\n" + str(await self.evaluate("document.body.innerText")))
        await self.evaluate("Array.from(document.querySelectorAll('button')).find(x=>x.innerText.trim()===" + json.dumps(text) + ").click()")
        await asyncio.sleep(settle)

    async def fill(self, label, text):
        await self.evaluate("Array.from(document.querySelectorAll('textarea')).find(x=>x.getAttribute('aria-label')===" + json.dumps(label) + ").focus()")
        await self.call("Input.dispatchKeyEvent", {"type": "keyDown", "key": "a", "code": "KeyA", "modifiers": 2, "windowsVirtualKeyCode": 65})
        await self.call("Input.dispatchKeyEvent", {"type": "keyUp", "key": "a", "code": "KeyA", "modifiers": 2, "windowsVirtualKeyCode": 65})
        await self.call("Input.insertText", {"text": text})
        await self.evaluate("document.activeElement.blur()")
        await asyncio.sleep(.5)

    async def select(self, label, text):
        await self.mouse("Array.from(document.querySelectorAll('input[role=combobox]')).find(x=>x.getAttribute('aria-label')===" + json.dumps(label) + ")")
        await asyncio.sleep(.3)
        await self.mouse("Array.from(document.querySelectorAll('[role=option]')).find(x=>x.innerText.includes(" + json.dumps(text) + "))")
        await asyncio.sleep(.6)

    async def mouse(self, expression):
        for _ in range(120):
            if await self.evaluate("Boolean(" + expression + ")"):
                break
            await asyncio.sleep(.25)
        point = await self.evaluate("(()=>{let e=" + expression + "; e.scrollIntoView({block:'center'}); let r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()")
        await self.call("Input.dispatchMouseEvent", {"type": "mouseMoved", **point})
        await self.call("Input.dispatchMouseEvent", {"type": "mousePressed", "button": "left", "clickCount": 1, **point})
        await self.call("Input.dispatchMouseEvent", {"type": "mouseReleased", "button": "left", "clickCount": 1, **point})

    async def screenshot(self, path):
        for _ in range(120):
            if await self.evaluate("(()=>{let e=document.querySelector('[data-testid=stStatusWidget]');return !e || e.getBoundingClientRect().width===0 || !e.innerText.includes('Stop')})()"):
                break
            await asyncio.sleep(.25)
        await asyncio.sleep(.5)
        # Streamlit scrolls inside its main section; document height stays at the viewport.
        height = await self.evaluate("Math.ceil(document.querySelector('[data-testid=stMainBlockContainer]').getBoundingClientRect().height + 120)")
        height = max(height, 1100)
        await self.call("Emulation.setDeviceMetricsOverride", {"width": 1440, "height": height, "deviceScaleFactor": 1, "mobile": False})
        await asyncio.sleep(.25)
        result = await self.call("Page.captureScreenshot", {"format": "png", "captureBeyondViewport": True,
                                 "clip": {"x": 0, "y": 0, "width": 1440, "height": height, "scale": 1}})
        path.write_bytes(base64.b64decode(result["data"]))
        await self.call("Emulation.setDeviceMetricsOverride", {"width": 1440, "height": 1100, "deviceScaleFactor": 1, "mobile": False})


async def main():
    smoke = "--production-smoke" in sys.argv
    fixture_smoke = "--fixture-smoke" in sys.argv
    app_url = "http://127.0.0.1:8501" if smoke else "http://127.0.0.1:8502"
    with tempfile.TemporaryDirectory(prefix="email-review-edge-", ignore_cleanup_errors=True) as profile:
        process = subprocess.Popen([r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
                                    "--headless=new", "--disable-gpu", "--no-proxy-server", "--disable-background-networking", "--remote-debugging-port=0",
                                    "--user-data-dir=" + profile, "about:blank"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            async with httpx.AsyncClient(trust_env=False) as client:
                for _ in range(80):
                    try:
                        port = (Path(profile) / "DevToolsActivePort").read_text().splitlines()[0]
                        targets = (await client.get(f"http://127.0.0.1:{port}/json/list")).json()
                        target = next(x for x in targets if x["type"] == "page")
                        break
                    except (httpx.HTTPError, StopIteration, FileNotFoundError):
                        await asyncio.sleep(.25)
                else:
                    raise RuntimeError("Edge debugging endpoint unavailable")
            async with connect(target["webSocketDebuggerUrl"], max_size=16000000, ping_interval=None, close_timeout=2) as socket:
                page = Page(socket)
                await page.call("Network.enable")
                await page.call("Network.setCacheDisabled", {"cacheDisabled": True})
                await page.call("Fetch.enable", {"patterns": [{"urlPattern": app_url + "/static/*", "requestStage": "Request"}]})
                await page.call("Emulation.setDeviceMetricsOverride", {"width": 1440, "height": 1100, "deviceScaleFactor": 1, "mobile": False})
                await page.call("Page.navigate", {"url": app_url})
                output = Path(__file__).resolve().parents[1] / "outputs" / "review-ui"
                output.mkdir(parents=True, exist_ok=True)
                if smoke:
                    await page.wait("读取全部未读邮件")
                    await page.screenshot(output / "09-production-ready.png")
                    print("PASS: actual production review app rendered; real mailbox untouched")
                    await page.call("Browser.close")
                    await page.http.aclose()
                    return
                if fixture_smoke:
                    await page.wait("选择邮件")
                    value = await page.evaluate("document.querySelector('input[aria-label=\"选择邮件\"]').value")
                    assert "待审核" not in value and "已完成" not in value
                    await page.screenshot(output / "10-final-review.png")
                    print("PASS: final mail selector and current checkpoint status rendered")
                    await page.call("Browser.close")
                    await page.http.aclose()
                    return
                await page.wait("已知悉")
                await page.click("读取全部未读邮件")
                await page.wait("本批 6 封：完成并标为已读 1 封，待人工处理 5 封，失败 0 封。")
                await page.screenshot(output / "11-batch-read-summary.png")
                await page.select("选择邮件", "系统维护通知")
                await page.click("已知悉")
                await page.wait("通知 · 1 封")
                await page.select("选择邮件", "账户续费通知")
                await page.wait("查看账户")
                assert not await page.evaluate("document.body.innerText.includes('促销广告')")
                assert await page.evaluate("Array.from(document.querySelectorAll('a')).some(x=>x.textContent==='查看账户')")
                await page.screenshot(output / "01-route.png")
                await page.fill("分类纠正说明（可选）", "账户续费需要回复确认。")
                await page.click("转为回复")
                await page.wait("路由偏好候选")
                await page.wait("拒绝候选，保留原文件")
                await page.screenshot(output / "02-triage-diff.png")
                await page.click("确认写入偏好文件")
                await page.wait("操作已完成")
                await page.select("选择邮件", "报告提交日期")
                await page.wait("请确认报告提交日期。")
                await page.screenshot(output / "03-question.png")
                await page.fill("补充事实 / 问题答案", "周五提交报告。")
                await page.fill("长期回复偏好反馈（可选）", "使用单句回复，保持简洁，不要虚构事实。")
                await page.click("提交答案并重新起草")
                await page.wait("Approve · 批准发送")
                await page.screenshot(output / "04-draft-and-diff.png")
                # A page reload must restore the same checkpoint-backed pending reply.
                await page.call("Page.reload")
                await page.wait("处理区域")
                await page.mouse("Array.from(document.querySelectorAll('label')).find(x=>x.innerText.trim()==='待回复')")
                await page.wait("选择邮件")
                await page.select("选择邮件", "报告提交日期")
                await page.wait("Approve · 批准发送")
                await page.fill("最终回复正文", "模拟失败")
                await page.mouse("Array.from(document.querySelectorAll('label')).find(x=>x.innerText.includes('我确认上述最终正文'))")
                await asyncio.sleep(.5)
                await page.click("Approve · 批准发送")
                await page.wait("操作失败（RuntimeError）")
                await page.screenshot(output / "05-send-error.png")
                assert await page.evaluate("Array.from(document.querySelectorAll('button')).some(x=>x.innerText.trim()==='Approve · 批准发送'&&x.disabled)")
                await page.click("拒绝候选，保留原文件")
                await page.select("选择邮件", "确认收件")
                await page.wait("Approve · 批准发送")
                await page.fill("最终回复正文", "确认收到报告。")
                await page.mouse("Array.from(document.querySelectorAll('label')).find(x=>x.innerText.includes('我确认上述最终正文'))")
                await asyncio.sleep(.5)
                await page.click("Approve · 批准发送", settle=0)
                for _ in range(40):
                    if await page.evaluate("Array.from(document.querySelectorAll('button')).some(x=>x.innerText.trim()==='Approve · 批准发送'&&x.disabled)"):
                        break
                    await asyncio.sleep(.05)
                else:
                    raise AssertionError("Approve must be disabled while the operation is running")
                await page.wait("该邮件已成功发送，批准发送已锁定。")
                assert not await page.evaluate("Array.from(document.querySelectorAll('button')).some(x=>x.innerText.trim()==='Approve · 批准发送'&&!x.disabled)")
                await page.screenshot(output / "06-sent-and-preference.png")
                await page.click("确认写入偏好文件")
                await page.wait("操作已完成")
                await page.select("选择邮件", "放弃本次回复")
                await page.wait("Approve · 批准发送")
                await page.click("Ignore · 放弃回复")
                await page.mouse("Array.from(document.querySelectorAll('label')).find(x=>x.innerText.trim()==='显示已完成')")
                await page.wait("待回复 · 4 封")
                await page.select("选择邮件", "放弃本次回复")
                await page.wait("当前状态：已完成")
                await page.screenshot(output / "07-ignore.png")
                await page.click("读取全部未读邮件")
                await page.wait("合成验收页面已禁用真实邮箱读取")
                await page.screenshot(output / "08-error-message.png")
                print("PASS: routing correction, Question, edit, reload recovery, simulated send failure/success, locked approval, preference confirmation, Ignore and error display")
                await page.call("Browser.close")
                await page.http.aclose()
        finally:
            if process.poll() is None:
                process.terminate()
            process.wait(timeout=15)


if __name__ == "__main__":
    asyncio.run(main())
