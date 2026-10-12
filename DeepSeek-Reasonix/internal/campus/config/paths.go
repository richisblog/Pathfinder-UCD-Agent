package config

import (
	"os"
	"path/filepath"
)

const (
	DataRootEnv = "PATHFINDER_DATA_ROOT"
	AppDirName  = "PathfinderUCD"
)

type Paths struct {
	AppDataDir string
	DBPath     string
	DataRoot   string
	SQLiteDir  string
	TextDir    string
}

func ResolvePaths() Paths {
	appData := os.Getenv("PATHFINDER_APP_DATA_DIR")
	if appData == "" {
		if userConfig, err := os.UserConfigDir(); err == nil && userConfig != "" {
			appData = filepath.Join(userConfig, AppDirName)
		} else {
			appData = filepath.Join(".", ".pathfinder")
		}
	}

	dataRoot := os.Getenv(DataRootEnv)
	if dataRoot == "" {
		if exePath, err := os.Executable(); err == nil {
			bundledDataPath := filepath.Join(filepath.Dir(exePath), "..", "Resources", "data")
			if _, err := os.Stat(bundledDataPath); err == nil {
				dataRoot = bundledDataPath
			}
		}
		if dataRoot == "" {
			dataRoot = filepath.Join(appData, "data")
		}
	}

	return Paths{
		AppDataDir: appData,
		DBPath:     filepath.Join(appData, "pathfinder.db"),
		DataRoot:   dataRoot,
		SQLiteDir:  filepath.Join(dataRoot, "sqlite"),
		TextDir:    filepath.Join(dataRoot, "txt"),
	}
}
