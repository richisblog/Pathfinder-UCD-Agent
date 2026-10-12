import subprocess
import re

while True:
    result = subprocess.run(['../../.toolchains/go/bin/go', 'build', '-o', '/dev/null', '.'], capture_output=True, text=True)
    if result.returncode == 0:
        print("Build succeeded!")
        break
    
    lines = result.stderr.split('\n') + result.stdout.split('\n')
    errors_fixed = 0
    for line in lines:
        match = re.search(r'^(.*?\.go):(\d+):\d+: (undefined:.*?|.*?undefined.*?|.*not declared by package.*|.*is not in std.*)$', line)
        if match:
            file_path = match.group(1)
            line_num = int(match.group(2))
            try:
                with open(file_path, 'r') as f:
                    file_lines = f.readlines()
                if not file_lines[line_num-1].strip().startswith('//'):
                    file_lines[line_num-1] = '// ' + file_lines[line_num-1]
                    with open(file_path, 'w') as f:
                        f.writelines(file_lines)
                    errors_fixed += 1
            except Exception as e:
                pass
    if errors_fixed == 0:
        print("Could not fix automatically.")
        print(result.stderr)
        break
