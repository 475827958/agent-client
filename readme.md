# 运行方式
cd d:/MyProject/project_money/agent/agent-electron-app

# 开发模式
npm run dev

# 构建
npm run build

# 打包安装包（需要 Windows，且 resources/ 下有图标文件）
npm run package

npx electron-builder --x64 --win nsis
