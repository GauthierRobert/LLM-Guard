# syntax=docker/dockerfile:1.7
# ---------- Build stage: Gradle + JDK 25 ----------
FROM eclipse-temurin:25-jdk AS build
WORKDIR /src

# Install Gradle explicitly (pinned version — avoid the wrapper for repeatable CI builds)
ARG GRADLE_VERSION=9.1.0
RUN apt-get update && apt-get install -y --no-install-recommends curl unzip ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && curl -fsSL "https://services.gradle.org/distributions/gradle-${GRADLE_VERSION}-bin.zip" -o /tmp/gradle.zip \
 && unzip -q /tmp/gradle.zip -d /opt && rm /tmp/gradle.zip \
 && ln -s "/opt/gradle-${GRADLE_VERSION}/bin/gradle" /usr/local/bin/gradle

COPY settings.gradle.kts build.gradle.kts gradle.properties ./
COPY src ./src

RUN gradle --no-daemon bootJar -x test

# ---------- Runtime stage: JRE 25 only ----------
FROM eclipse-temurin:25-jre
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends curl \
 && rm -rf /var/lib/apt/lists/*
RUN useradd --system --uid 10001 --gid 0 --create-home --home-dir /home/app app
USER 10001

COPY --from=build /src/build/libs/*.jar /app/app.jar

EXPOSE 8000

ENV JAVA_TOOL_OPTIONS="-XX:+UseZGC -XX:MaxRAMPercentage=75 -Dfile.encoding=UTF-8"

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD curl -fsS http://localhost:8000/v1/health >/dev/null || exit 1

ENTRYPOINT ["java", "-jar", "/app/app.jar"]
