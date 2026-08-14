package services

import (
	"errors"
	"testing"

	"github.com/naiba/bonds/internal/dto"
	"github.com/naiba/bonds/internal/models"
	"github.com/naiba/bonds/internal/testutil"
	"gorm.io/gorm"
)

type contactLayoutTestContext struct {
	db        *gorm.DB
	service   *ContactLayoutService
	vaultSvc  *VaultService
	accountID string
	userID    string
	vaultID   string
}

func setupContactLayoutTest(t *testing.T) *contactLayoutTestContext {
	t.Helper()
	db := testutil.SetupTestDB(t)
	auth := NewAuthService(db, testutil.TestJWTConfig())
	registered, err := auth.Register(dto.RegisterRequest{
		FirstName: "Layout", LastName: "Manager", Email: "layout@example.com", Password: "password123",
	}, "en")
	if err != nil {
		t.Fatalf("register: %v", err)
	}
	vaultSvc := NewVaultService(db)
	vault, err := vaultSvc.CreateVault(registered.User.AccountID, registered.User.ID, dto.CreateVaultRequest{Name: "Layout Vault"}, "en")
	if err != nil {
		t.Fatalf("create vault: %v", err)
	}
	return &contactLayoutTestContext{
		db: db, service: NewContactLayoutService(db), vaultSvc: vaultSvc,
		accountID: registered.User.AccountID, userID: registered.User.ID, vaultID: vault.ID,
	}
}

func TestDefaultContactLayoutRendersEachRelationshipModuleOnce(t *testing.T) {
	ctx := setupContactLayoutTest(t)
	contact, err := NewContactService(ctx.db).CreateContact(ctx.vaultID, ctx.userID, dto.CreateContactRequest{FirstName: "Alex"})
	if err != nil {
		t.Fatalf("create contact: %v", err)
	}
	tabs, err := NewContactTabService(ctx.db).GetTabs(contact.ID, ctx.vaultID, "en")
	if err != nil {
		t.Fatalf("get tabs: %v", err)
	}
	counts := map[string]int{}
	for _, page := range tabs.Pages {
		for _, module := range page.Modules {
			counts[module.Type]++
		}
	}
	if counts["relationships"] != 1 || counts["relationship_network"] != 1 {
		t.Fatalf("relationship modules must be singleton, got %v", counts)
	}
}

func TestContactLayoutSaveClonePreservesHiddenPagesAndBuiltInTranslations(t *testing.T) {
	ctx := setupContactLayoutTest(t)
	layout := defaultContactLayout(t, ctx, "zh")
	req := saveRequestFromLayout(layout)
	for index := range req.Pages {
		if req.Pages[index].Slug == "relationship-network" {
			req.Pages[index].Visible = false
		}
	}
	if pageBySlug(t, layout, "relationship-network").ID == 0 {
		t.Fatal("default relationship-network page missing")
	}
	saved, err := ctx.service.Save(ctx.vaultID, layout.ID, req, "zh")
	if err != nil {
		t.Fatalf("save layout: %v", err)
	}
	if saved.Revision != layout.Revision+1 {
		t.Fatalf("revision = %d, want %d", saved.Revision, layout.Revision+1)
	}

	english, err := ctx.service.Get(ctx.vaultID, layout.ID, "en")
	if err != nil {
		t.Fatalf("get English layout: %v", err)
	}
	if pageBySlug(t, english, "social").Name != "Social" {
		t.Fatalf("saving in Chinese froze a translated system name: %+v", pageBySlug(t, english, "social"))
	}
	var stored models.VaultContactTemplatePage
	if err := ctx.db.Where("template_id = ? AND slug = ?", layout.ID, "relationship-network").First(&stored).Error; err != nil {
		t.Fatalf("load stored page: %v", err)
	}
	if stored.NameTranslationKey == nil {
		t.Fatal("unchanged built-in page lost its translation key")
	}

	clone, err := ctx.service.Create(ctx.vaultID, "en", dto.CreateContactLayoutTemplateRequest{
		Name: "Hidden network", SourceTemplateID: &layout.ID,
	})
	if err != nil {
		t.Fatalf("clone layout: %v", err)
	}
	if pageBySlug(t, clone, "relationship-network").Visible {
		t.Fatal("cloning re-enabled a hidden page")
	}
}

func TestContactLayoutCustomPageNameIsSharedText(t *testing.T) {
	ctx := setupContactLayoutTest(t)
	layout := defaultContactLayout(t, ctx, "zh")
	req := saveRequestFromLayout(layout)
	for index := range req.Pages {
		if req.Pages[index].Slug == "social" {
			req.Pages[index].Name = "Family circle"
		}
	}
	if _, err := ctx.service.Save(ctx.vaultID, layout.ID, req, "zh"); err != nil {
		t.Fatalf("save custom name: %v", err)
	}
	english, err := ctx.service.Get(ctx.vaultID, layout.ID, "en")
	if err != nil {
		t.Fatalf("get English layout: %v", err)
	}
	if got := pageBySlug(t, english, "social").Name; got != "Family circle" {
		t.Fatalf("custom shared name = %q", got)
	}
}

func TestContactLayoutRejectsInvalidAndDuplicateModules(t *testing.T) {
	ctx := setupContactLayoutTest(t)
	layout := defaultContactLayout(t, ctx, "en")

	tests := []struct {
		name   string
		mutate func(*dto.SaveContactLayoutRequest)
	}{
		{name: "duplicate module across siblings", mutate: func(req *dto.SaveContactLayoutRequest) {
			req.Pages[0].Modules = append(req.Pages[0].Modules, dto.SaveContactLayoutModuleRequest{Key: "relationships"})
		}},
		{name: "unknown module", mutate: func(req *dto.SaveContactLayoutRequest) {
			req.Pages[0].Modules = append(req.Pages[0].Modules, dto.SaveContactLayoutModuleRequest{Key: "future-module"})
		}},
		{name: "duplicate slug", mutate: func(req *dto.SaveContactLayoutRequest) {
			req.Pages[1].Slug = req.Pages[0].Slug
		}},
		{name: "all pages hidden", mutate: func(req *dto.SaveContactLayoutRequest) {
			for index := range req.Pages {
				req.Pages[index].Visible = false
			}
		}},
		{name: "page from another template", mutate: func(req *dto.SaveContactLayoutRequest) {
			foreign := uint(999999)
			req.Pages[0].ID = &foreign
		}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			req := saveRequestFromLayout(layout)
			test.mutate(&req)
			_, err := ctx.service.Save(ctx.vaultID, layout.ID, req, "en")
			if !errors.Is(err, ErrContactLayoutInvalid) {
				t.Fatalf("expected ErrContactLayoutInvalid, got %v", err)
			}
		})
	}
}

func TestContactLayoutOptimisticRevisionPreventsLostUpdates(t *testing.T) {
	ctx := setupContactLayoutTest(t)
	layout := defaultContactLayout(t, ctx, "en")
	winner := saveRequestFromLayout(layout)
	winner.Pages[0].Name = "Winner"
	if _, err := ctx.service.Save(ctx.vaultID, layout.ID, winner, "en"); err != nil {
		t.Fatalf("save winner: %v", err)
	}
	stale := saveRequestFromLayout(layout)
	stale.Pages[0].Name = "Stale"
	if _, err := ctx.service.Save(ctx.vaultID, layout.ID, stale, "en"); !errors.Is(err, ErrContactLayoutConflict) {
		t.Fatalf("expected revision conflict, got %v", err)
	}
	current, err := ctx.service.Get(ctx.vaultID, layout.ID, "en")
	if err != nil {
		t.Fatalf("get current layout: %v", err)
	}
	if current.Pages[0].Name != "Winner" {
		t.Fatalf("stale save overwrote winner: %q", current.Pages[0].Name)
	}
}

func TestContactLayoutsAreStrictlyVaultScoped(t *testing.T) {
	ctx := setupContactLayoutTest(t)
	otherVault, err := ctx.vaultSvc.CreateVault(ctx.accountID, ctx.userID, dto.CreateVaultRequest{Name: "Other Vault"}, "en")
	if err != nil {
		t.Fatalf("create other vault: %v", err)
	}
	source := defaultContactLayout(t, ctx, "en")
	otherService := NewContactLayoutService(ctx.db)

	if _, err := otherService.Get(otherVault.ID, source.ID, "en"); !errors.Is(err, ErrContactLayoutNotFound) {
		t.Fatalf("cross-vault get returned %v", err)
	}
	if _, err := otherService.Create(otherVault.ID, "en", dto.CreateContactLayoutTemplateRequest{Name: "Copy", SourceTemplateID: &source.ID}); !errors.Is(err, ErrContactLayoutNotFound) {
		t.Fatalf("cross-vault clone returned %v", err)
	}
	if err := otherService.SetDefault(otherVault.ID, source.ID); !errors.Is(err, ErrContactLayoutNotFound) {
		t.Fatalf("cross-vault default returned %v", err)
	}
	if _, err := otherService.Save(otherVault.ID, source.ID, saveRequestFromLayout(source), "en"); !errors.Is(err, ErrContactLayoutNotFound) {
		t.Fatalf("cross-vault save returned %v", err)
	}
	if err := otherService.Delete(otherVault.ID, source.ID); !errors.Is(err, ErrContactLayoutNotFound) {
		t.Fatalf("cross-vault delete returned %v", err)
	}

	contact := models.Contact{VaultID: otherVault.ID, FirstName: serviceStringPointer("Cross vault"), TemplateID: &source.ID}
	if err := ctx.db.Create(&contact).Error; !errors.Is(err, models.ErrContactTemplateOutsideVault) {
		t.Fatalf("model accepted a cross-vault template: %v", err)
	}
}

func TestContactLayoutTemplateNamesAreCaseInsensitivePerVault(t *testing.T) {
	ctx := setupContactLayoutTest(t)
	layout := defaultContactLayout(t, ctx, "en")
	created, err := ctx.service.Create(ctx.vaultID, "en", dto.CreateContactLayoutTemplateRequest{Name: "Family", SourceTemplateID: &layout.ID})
	if err != nil {
		t.Fatalf("create template: %v", err)
	}
	if _, err := ctx.service.Create(ctx.vaultID, "en", dto.CreateContactLayoutTemplateRequest{Name: " family ", SourceTemplateID: &layout.ID}); !errors.Is(err, ErrContactLayoutNameExists) {
		t.Fatalf("case-insensitive duplicate returned %v", err)
	}
	if _, err := ctx.service.Rename(ctx.vaultID, created.ID, dto.UpdateContactLayoutTemplateRequest{Name: "FAMILY"}, "en"); err != nil {
		t.Fatalf("renaming the same template with different case should work: %v", err)
	}
}

func defaultContactLayout(t *testing.T, ctx *contactLayoutTestContext, locale string) *dto.ContactLayoutResponse {
	t.Helper()
	items, err := ctx.service.List(ctx.vaultID, locale)
	if err != nil {
		t.Fatalf("list layouts: %v", err)
	}
	for _, item := range items {
		if item.IsDefault {
			layout, err := ctx.service.Get(ctx.vaultID, item.ID, locale)
			if err != nil {
				t.Fatalf("get default layout: %v", err)
			}
			return layout
		}
	}
	t.Fatal("default layout missing")
	return nil
}

func saveRequestFromLayout(layout *dto.ContactLayoutResponse) dto.SaveContactLayoutRequest {
	pages := make([]dto.SaveContactLayoutPageRequest, len(layout.Pages))
	for pageIndex, page := range layout.Pages {
		pageID := page.ID
		modules := make([]dto.SaveContactLayoutModuleRequest, len(page.Modules))
		for moduleIndex, module := range page.Modules {
			modules[moduleIndex] = dto.SaveContactLayoutModuleRequest{Key: module.Key}
		}
		pages[pageIndex] = dto.SaveContactLayoutPageRequest{
			ID: &pageID, Name: page.Name, Slug: page.Slug, Type: page.Type,
			Visible: page.Visible, Modules: modules,
		}
	}
	return dto.SaveContactLayoutRequest{ExpectedRevision: layout.Revision, Pages: pages}
}

func pageBySlug(t *testing.T, layout *dto.ContactLayoutResponse, slug string) dto.ContactLayoutPage {
	t.Helper()
	for _, page := range layout.Pages {
		if page.Slug == slug {
			return page
		}
	}
	t.Fatalf("page %q missing", slug)
	return dto.ContactLayoutPage{}
}

func serviceStringPointer(value string) *string {
	return &value
}
