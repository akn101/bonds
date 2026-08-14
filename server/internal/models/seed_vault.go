package models

import (
	"github.com/naiba/bonds/internal/i18n"
	"gorm.io/gorm"
)

func SeedVaultDefaults(tx *gorm.DB, vaultID, locale string) error {
	seeders := []func(*gorm.DB, string, string) error{
		func(tx *gorm.DB, vaultID, _ string) error { return SeedVaultContactLayout(tx, vaultID) },
		seedContactImportantDateTypes,
		seedMoodTrackingParameters,
		seedActivityCategoriesAndTypes,
		seedInteractionActivityTypes,
		seedVaultQuickFactsTemplates,
	}
	for _, fn := range seeders {
		if err := fn(tx, vaultID, locale); err != nil {
			return err
		}
	}
	return nil
}

func seedContactImportantDateTypes(tx *gorm.DB, vaultID, locale string) error {
	type dateDef struct {
		key          string
		internalType string
	}
	defs := []dateDef{
		{"seed.important_date_types.birthdate", "birthdate"},
		{"seed.important_date_types.deceased_date", "deceased_date"},
		{"seed.important_date_types.anniversary", ""},
		{"seed.important_date_types.wedding", ""},
		{"seed.important_date_types.one_time", ""},
	}
	items := make([]ContactImportantDateType, len(defs))
	for idx, d := range defs {
		key := d.key
		items[idx] = ContactImportantDateType{
			VaultID:             vaultID,
			Label:               i18n.T(locale, d.key),
			LabelTranslationKey: &key,
			InternalType:        strPtr(d.internalType),
		}
	}
	if err := tx.Create(&items).Error; err != nil {
		return err
	}
	var undeletableIDs []uint
	for i, d := range defs {
		if d.internalType != "" {
			undeletableIDs = append(undeletableIDs, items[i].ID)
		}
	}
	if len(undeletableIDs) > 0 {
		return tx.Model(&ContactImportantDateType{}).
			Where("id IN ?", undeletableIDs).
			Update("can_be_deleted", false).Error
	}
	return nil
}

func seedMoodTrackingParameters(tx *gorm.DB, vaultID, locale string) error {
	type moodDef struct {
		key      string
		hexColor string
		position int
	}
	defs := []moodDef{
		{"seed.mood_tracking.awesome", "bg-lime-500", 1},
		{"seed.mood_tracking.good", "bg-lime-300", 2},
		{"seed.mood_tracking.meh", "bg-cyan-600", 3},
		{"seed.mood_tracking.bad", "bg-orange-300", 4},
		{"seed.mood_tracking.awful", "bg-red-700", 5},
	}
	items := make([]MoodTrackingParameter, len(defs))
	for idx, d := range defs {
		items[idx] = MoodTrackingParameter{
			VaultID:             vaultID,
			Label:               strPtr(i18n.T(locale, d.key)),
			LabelTranslationKey: strPtr(d.key),
			HexColor:            d.hexColor,
			Position:            intPtr(d.position),
		}
	}
	return tx.Create(&items).Error
}

func seedActivityCategoriesAndTypes(tx *gorm.DB, vaultID, locale string) error {
	type categoryDef struct {
		key      string
		position int
		types    []string
	}

	categories := []categoryDef{
		{"seed.activity_categories.transportation", 1, []string{
			"seed.activity_types.rode_a_bike",
			"seed.activity_types.drove",
			"seed.activity_types.walked",
			"seed.activity_types.took_the_bus",
			"seed.activity_types.took_the_metro",
		}},
		{"seed.activity_categories.social", 2, []string{
			"seed.activity_types.ate",
			"seed.activity_types.drank",
			"seed.activity_types.went_to_a_bar",
			"seed.activity_types.watched_a_movie",
			"seed.activity_types.watched_tv",
			"seed.activity_types.watched_a_tv_show",
		}},
		{"seed.activity_categories.sport", 3, []string{
			"seed.activity_types.ran",
			"seed.activity_types.played_soccer",
			"seed.activity_types.played_basketball",
			"seed.activity_types.played_golf",
			"seed.activity_types.played_tennis",
		}},
		{"seed.activity_categories.work", 4, []string{
			"seed.activity_types.took_a_new_job",
			"seed.activity_types.quit_job",
			"seed.activity_types.got_fired",
			"seed.activity_types.had_a_promotion",
		}},
	}

	for _, cat := range categories {
		pos := cat.position
		// Activity seed defaults are editable in Settings, so persist them as
		// deletable here. Older vaults seeded before this flag was set are
		// repaired by BackfillActivityDefaultDeletability on boot.
		category := ActivityCategory{
			VaultID:             vaultID,
			Label:               strPtr(i18n.T(locale, cat.key)),
			LabelTranslationKey: strPtr(cat.key),
			Position:            &pos,
			CanBeDeleted:        true,
		}
		if err := tx.Create(&category).Error; err != nil {
			return err
		}
		for idx, typeKey := range cat.types {
			typePos := idx + 1
			activityType := ActivityType{
				ActivityCategoryID:  category.ID,
				Label:               strPtr(i18n.T(locale, typeKey)),
				LabelTranslationKey: strPtr(typeKey),
				Position:            &typePos,
				CanBeDeleted:        true,
			}
			if err := tx.Create(&activityType).Error; err != nil {
				return err
			}
		}
	}
	return nil
}

type interactionActivityTypeDef struct {
	key        string
	systemKind string
	icon       string
	color      string
}

var interactionActivityTypeDefs = []interactionActivityTypeDef{
	{"seed.activity_types.phone_call", "phone_call", "phone", "#1677ff"},
	{"seed.activity_types.video_call", "video_call", "video-camera", "#722ed1"},
	{"seed.activity_types.in_person_meeting", "in_person_meeting", "team", "#52c41a"},
}

func seedInteractionActivityTypes(tx *gorm.DB, vaultID, locale string) error {
	categoryKey := "seed.activity_categories.interactions"
	position := 5
	category := ActivityCategory{
		VaultID:             vaultID,
		Label:               strPtr(i18n.T(locale, categoryKey)),
		LabelTranslationKey: &categoryKey,
		Position:            &position,
		CanBeDeleted:        true,
	}
	if err := tx.Create(&category).Error; err != nil {
		return err
	}
	for idx, def := range interactionActivityTypeDefs {
		position := idx + 1
		def := def
		typeModel := ActivityType{
			ActivityCategoryID:  category.ID,
			Label:               strPtr(i18n.T(locale, def.key)),
			LabelTranslationKey: strPtr(def.key),
			Position:            &position,
			CanBeDeleted:        true,
			SystemKind:          &def.systemKind,
			Icon:                &def.icon,
			Color:               &def.color,
			CountsAsInteraction: true,
		}
		if err := tx.Create(&typeModel).Error; err != nil {
			return err
		}
	}
	return nil
}

func seedVaultQuickFactsTemplates(tx *gorm.DB, vaultID, locale string) error {
	type qfDef struct {
		key      string
		position int
	}
	defs := []qfDef{
		{"seed.quick_facts.how_we_met", 1},
		{"seed.quick_facts.hobbies", 2},
		{"seed.quick_facts.food_preferences", 3},
	}
	items := make([]VaultQuickFactsTemplate, len(defs))
	for idx, d := range defs {
		items[idx] = VaultQuickFactsTemplate{
			VaultID:             vaultID,
			Label:               strPtr(i18n.T(locale, d.key)),
			LabelTranslationKey: strPtr(d.key),
			Position:            d.position,
		}
	}
	return tx.Create(&items).Error
}
