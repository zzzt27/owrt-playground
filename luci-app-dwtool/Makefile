include $((TOPDIR))/rules.mk

PKG_NAME:=luci-app-dwtool
PKG_VERSION:=1.0.0
PKG_RELEASE:=1

PKG_MAINTAINER:=Antigravity AI

include $((INCLUDE_DIR))/package.mk

define Package/luci-app-dwtool
  SECTION:=luci
  CATEGORY:=LuCI
  SUBMENU:=3. Applications
  TITLE:=LuCI support for Dell DW5821e LTE Toolkits
  DEPENDS:=+curl +jq +sms-tool +modemmanager
  PKGARCH:=all
endef

define Package/luci-app-dwtool/description
  LuCI support for Dell DW5821e LTE Toolkits including status dashboard, band locking, IMEI changer, watchdog, and SMS forwarding.
endef

define Build/Compile
endef

define Package/luci-app-dwtool/install
	$(CP) ./files/* $(1)/
endef

$(eval $(call BuildPackage,luci-app-dwtool))
