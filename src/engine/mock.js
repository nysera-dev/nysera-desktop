// Offline mock provider: NYSERA_MOCK=1 lets you try every command without an API key.
// It returns deterministic, realistic-looking replies so the whole pipeline can run.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function mockComplete(model, messages) {
  await sleep(300 + Math.random() * 900);
  // Simulate a provider rejecting one model so fallback is visible.
  if (model.includes('qwen') && Math.random() < 0.5) {
    const e = new Error('model temporarily unavailable (mock)');
    e.status = 503;
    throw e;
  }
  const sys = messages[0] ? messages[0].content : '';
  const user = messages[messages.length - 1].content;

  if (sys.includes('NYSERA_PLANNER')) {
    return {
      content: JSON.stringify({
        summary: 'Write the program, write its test, then document it.',
        lanes: [
          { id: 'L1', title: 'Write hello.py', category: 'code', depends_on: [], prompt: 'Create hello.py that prints Hello, world! from a main() function.' },
          { id: 'L2', title: 'Write test_hello.py', category: 'test', depends_on: ['L1'], prompt: 'Write a unittest for hello.main() that captures stdout.' },
          { id: 'L3', title: 'Write README', category: 'docs', depends_on: ['L1'], prompt: 'Short README explaining how to run hello.py and the test.' }
        ]
      })
    };
  }
  if (sys.includes('NYSERA_REVIEWER')) {
    return { content: JSON.stringify({ pass: true, notes: 'Output matches the lane goal. (mock review)' }) };
  }
  if (sys.includes("Nysera's fixer")) {
    return { content: '### FILE: hello.py\n```python\ndef main():\n    print("Hello, world!")\n\nif __name__ == "__main__":\n    main()\n```\nThe greeting was missing its comma. (mock fix)' };
  }
  const lane = (user.match(/Your lane \((L\d+)/) || [])[1];
  // NYSERA_MOCK_BUG=1: the code lane ships a bug so the self-repair loop can be seen.
  if (lane === 'L1' && process.env.NYSERA_MOCK_BUG) {
    return { content: '### FILE: hello.py\n```python\ndef main():\n    print("Hello world")\n```\n' };
  }
  if (lane === 'L2') {
    return { content: 'Here is the test.\n\n### FILE: test_hello.py\n```python\nimport io, unittest\nfrom contextlib import redirect_stdout\nimport hello\n\nclass T(unittest.TestCase):\n    def test_main(self):\n        buf = io.StringIO()\n        with redirect_stdout(buf):\n            hello.main()\n        self.assertEqual(buf.getvalue().strip(), "Hello, world!")\n\nif __name__ == "__main__":\n    unittest.main()\n```\n' };
  }
  if (lane === 'L3') {
    return { content: '### FILE: README.md\n```markdown\n# Hello\n\nRun `python hello.py`. Test with `python -m unittest`.\n```\n' };
  }
  return { content: 'Done.\n\n### FILE: hello.py\n```python\ndef main():\n    print("Hello, world!")\n\nif __name__ == "__main__":\n    main()\n```\n' };
}
