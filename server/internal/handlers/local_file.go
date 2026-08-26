package handlers

import (
	"fmt"
	"net/http"
	"os"
	"strings"

	"github.com/labstack/echo/v5"
)

var contentDispositionQuoteEscaper = strings.NewReplacer("\\", "\\\\", `"`, `\"`)

func serveLocalFile(c *echo.Context, filePath string) error {
	file, err := os.Open(filePath)
	if err != nil {
		if os.IsNotExist(err) {
			return echo.ErrNotFound
		}
		return err
	}
	defer file.Close()

	info, err := file.Stat()
	if err != nil {
		return err
	}
	http.ServeContent(c.Response(), c.Request(), info.Name(), info.ModTime(), file)
	return nil
}

func serveLocalFileWithDisposition(c *echo.Context, filePath, name, disposition string) error {
	c.Response().Header().Set(
		echo.HeaderContentDisposition,
		fmt.Sprintf(`%s; filename="%s"`, disposition, contentDispositionQuoteEscaper.Replace(name)),
	)
	return serveLocalFile(c, filePath)
}
