from pathlib import Path

BASE = Path.cwd()
FOLDERS = ["prompts", "docs", "notion", "src", "scripts", ".vscode"]

def main():
    for folder in FOLDERS:
        (BASE / folder).mkdir(parents=True, exist_ok=True)
    print(f"Workspace ready at: {BASE}")

if __name__ == "__main__":
    main()
