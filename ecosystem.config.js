module.exports = {
  apps: [
    {
      name: "nomad-ai-server",
      script: ".venv/bin/python",
      args: "-m uvicorn issai_service:app --host 0.0.0.0 --port 8001",
      interpreter: "none",
      cwd: "./"
    },
    {
      name: "nomad-whatsapp-bot",
      script: "npm",
      args: "start",
      cwd: "./nomad-whatsapp-bot"
    }
  ]
};
