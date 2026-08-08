package services

import (
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/naiba/bonds/internal/dto"
	"github.com/naiba/bonds/internal/models"
	"github.com/naiba/bonds/internal/testutil"
)

func setupUnifiedLifeEventTest(t *testing.T) (*LifeEventService, string, models.Contact, models.Contact, uint) {
	t.Helper()
	db := testutil.SetupTestDB(t)
	account := models.Account{}
	if err := db.Create(&account).Error; err != nil {
		t.Fatal(err)
	}
	vault := models.Vault{AccountID: account.ID, Name: "Vault", Type: "personal"}
	if err := db.Create(&vault).Error; err != nil {
		t.Fatal(err)
	}
	primary := models.Contact{VaultID: vault.ID, FirstName: strPtrOrNil("Primary")}
	if err := db.Create(&primary).Error; err != nil {
		t.Fatal(err)
	}
	mentioned := models.Contact{VaultID: vault.ID, FirstName: strPtrOrNil("Mentioned")}
	if err := db.Create(&mentioned).Error; err != nil {
		t.Fatal(err)
	}
	category := models.LifeEventCategory{VaultID: vault.ID}
	if err := db.Create(&category).Error; err != nil {
		t.Fatal(err)
	}
	eventType := models.LifeEventType{LifeEventCategoryID: category.ID}
	if err := db.Create(&eventType).Error; err != nil {
		t.Fatal(err)
	}
	return NewLifeEventService(db), vault.ID, primary, mentioned, eventType.ID
}

func TestLifeEventCRUDMentionsPeriodsAndMilestones(t *testing.T) {
	svc, vaultID, primary, mentioned, typeID := setupUnifiedLifeEventTest(t)
	start := time.Date(2022, 7, 1, 0, 0, 0, 0, time.UTC)
	description := fmt.Sprintf("Worked with @[Mentioned](contact:%s)", mentioned.ID)
	parent, err := svc.Create(vaultID, dto.LifeEventUpsertRequest{PrimaryContactID: primary.ID, LifeEventTypeID: typeID, Title: "Worked at Acme", Description: description, StartDate: &start, StartPrecision: "month", EndStatus: "ongoing"})
	if err != nil {
		t.Fatal(err)
	}
	if len(parent.Participants) != 2 {
		t.Fatalf("participants = %+v", parent.Participants)
	}
	milestoneStart := start.AddDate(1, 0, 0)
	milestone, err := svc.Create(vaultID, dto.LifeEventUpsertRequest{PrimaryContactID: primary.ID, ParentID: &parent.ID, LifeEventTypeID: typeID, Title: "Promoted", StartDate: &milestoneStart, StartPrecision: "day", EndStatus: "none"})
	if err != nil || milestone.ParentID == nil || *milestone.ParentID != parent.ID {
		t.Fatalf("milestone=%+v err=%v", milestone, err)
	}
	items, meta, err := svc.List(vaultID, mentioned.ID, 1, 15)
	if err != nil || meta.Total != 1 || items[0].ID != parent.ID {
		t.Fatalf("mention list=%+v meta=%+v err=%v", items, meta, err)
	}
	end := start.Add(-time.Hour)
	_, err = svc.Update(vaultID, parent.ID, dto.LifeEventUpsertRequest{PrimaryContactID: primary.ID, LifeEventTypeID: typeID, Title: "Invalid", StartDate: &start, EndDate: &end, EndStatus: "known"})
	if !errors.Is(err, ErrInvalidLifeEventTime) {
		t.Fatalf("invalid period error=%v", err)
	}
	if err := svc.Delete(vaultID, parent.ID); err != nil {
		t.Fatal(err)
	}
	var reloaded models.LifeEvent
	if err := svc.db.First(&reloaded, milestone.ID).Error; err != nil || reloaded.ParentID != nil {
		t.Fatalf("detached milestone=%+v err=%v", reloaded, err)
	}
}

func TestContactMentionIDsDedupe(t *testing.T) {
	id := "550e8400-e29b-41d4-a716-446655440000"
	ids := contactMentionIDs("hi @[A](contact:" + id + ") and @[Again](contact:" + id + ")")
	if len(ids) != 1 || ids[0] != id {
		t.Fatalf("ids=%v", ids)
	}
}
